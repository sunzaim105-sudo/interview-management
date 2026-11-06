import {
  APP_ORIGIN,
  GMAIL_OAUTH_REDIRECT_URI,
  getGoogleClientCredentials,
  getGoogleOAuthEndpoints,
  withGoogleEnvFile,
} from './googleOAuthConfig.js';
import {
  getAccountLimiter,
  isMalformedGmailError,
  isQuotaError,
} from './gmailRateLimit.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** Read-only Gmail scope only — no send / modify / delete. openid first (OIDC). */
export const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

/**
 * Interview / job keyword OR-group for Gmail search (`{a b c}` = match any).
 * Applied in the Gmail API `q` parameter at fetch time — not after download.
 */
export const INTERVIEW_MAIL_KEYWORDS = [
  'interview',
  'assessment',
  'recruiter',
  '"next steps"',
  '"schedule a call"',
  '"book a time"',
  '"technical interview"',
  '"coding challenge"',
  'shortlisted',
  'calendly',
];

/** Exact base filter used for sync (before optional job/team extra terms). */
export const INTERVIEW_MAIL_BASE_QUERY =
  'newer_than:7d -category:promotions -category:social {interview assessment recruiter "next steps" "schedule a call" "book a time" "technical interview" "coding challenge" shortlisted calendly}';

export function getGmailOAuthConfig(env) {
  const e = withGoogleEnvFile(env);
  const { clientId, clientSecret } = getGoogleClientCredentials(e);
  const redirect =
    String(e.GMAIL_OAUTH_REDIRECT_URI || '').trim() || GMAIL_OAUTH_REDIRECT_URI;
  // localhost ≠ 127.0.0.1 for Google OAuth — keep the registered URI.
  const redirectUri = redirect.includes('127.0.0.1')
    ? GMAIL_OAUTH_REDIRECT_URI
    : redirect;
  const origin = String(e.APP_ORIGIN || '').trim() || APP_ORIGIN;
  const appOrigin = origin.includes('127.0.0.1') ? APP_ORIGIN : origin;
  const tokenSecret = String(
    e.GMAIL_TOKEN_SECRET ||
      e.SUPABASE_SECRET_KEY ||
      e.SUPABASE_SERVICE_ROLE_KEY ||
      '',
  ).trim();

  return {
    clientId: String(clientId || '').trim(),
    clientSecret: String(clientSecret || '').trim(),
    redirectUri: String(redirectUri || '').trim(),
    appOrigin: String(appOrigin || '').trim().replace(/\/$/, ''),
    tokenSecret,
  };
}

export function buildGmailAuthUrl({
  clientId,
  redirectUri,
  state,
  loginHint = '',
  env = {},
}) {
  const { authUri } = getGoogleOAuthEndpoints(env);
  // Prefer v2 authorize endpoint; legacy /o/oauth2/auth still works but
  // rejects some malformed param combos more cryptically (HTTP 400 page).
  const normalizedAuth =
    String(authUri || '').includes('/o/oauth2/auth') &&
    !String(authUri || '').includes('/v2/')
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : authUri || 'https://accounts.google.com/o/oauth2/v2/auth';

  const id = String(clientId || '').trim();
  const redirect = String(redirectUri || '').trim();
  const stateValue = String(state || '').trim();
  if (!id || !redirect || !stateValue) {
    throw Object.assign(
      new Error(
        'Cannot start Google OAuth: client_id, redirect_uri, and state are required.',
      ),
      { status: 500 },
    );
  }

  const url = new URL(normalizedAuth);
  url.searchParams.set('client_id', id);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('state', stateValue);
  // Account chooser + consent (refresh token). Avoid login_hint: a mismatched
  // signed-in Google session (authuser=N) often 400s on /signin/oauth/warning.
  url.searchParams.set('prompt', 'select_account consent');
  void loginHint; // kept for callers; intentionally not sent to Google
  return url.toString();
}

/**
 * Build the Gmail API `q` string used when listing threads.
 * Filtering happens in Gmail — callers must pass this as `q`, not post-filter.
 *
 * Base (always):
 *   newer_than:7d -category:promotions -category:social
 *   {interview assessment recruiter "next steps" "schedule a call"
 *    "book a time" "technical interview" "coding challenge" shortlisted calendly}
 *
 * Optional: job/company/team terms OR'd into the same `{…}` group;
 *           UI search / unread flags appended.
 */
export function buildInterviewMailQuery({
  extraTerms = [],
  userQuery = '',
  unreadOnly = false,
} = {}) {
  const safeExtras = [...new Set(extraTerms)]
    .map((term) => String(term || '').trim())
    .filter((term) => term.length >= 3)
    .slice(0, 40)
    .map((term) => {
      const cleaned = term.replace(/"/g, '');
      return /\s/.test(cleaned) ? `"${cleaned}"` : cleaned;
    });

  const keywordGroup = [...INTERVIEW_MAIL_KEYWORDS, ...safeExtras];
  const parts = [
    'newer_than:7d',
    '-category:promotions',
    '-category:social',
    `{${keywordGroup.join(' ')}}`,
  ];

  if (userQuery.trim()) parts.push(`(${userQuery.trim()})`);
  if (unreadOnly) parts.push('is:unread');
  return parts.join(' ');
}

export async function exchangeCodeForTokens(env, code) {
  const { clientId, clientSecret, redirectUri } = getGmailOAuthConfig(env);
  const { tokenUri } = getGoogleOAuthEndpoints(env);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw Object.assign(
      new Error(
        payload.error_description ||
          payload.error ||
          'Failed to exchange Gmail OAuth code.',
      ),
      { status: 502 },
    );
  }
  return payload;
}

export async function refreshAccessToken(env, refreshToken) {
  const { clientId, clientSecret } = getGmailOAuthConfig(env);
  const { tokenUri } = getGoogleOAuthEndpoints(env);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw Object.assign(
      new Error(
        payload.error_description ||
          payload.error ||
          'Failed to refresh Gmail access token. Reconnect the account.',
      ),
      { status: 401 },
    );
  }
  return payload;
}

export async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to load Google user info.'),
      { status: 502 },
    );
  }
  return payload;
}

function gmailErrorFromResponse(status, payload) {
  const errBody = payload?.error || {};
  const message =
    errBody.message ||
    payload?.error_description ||
    `Gmail API error (${status}).`;
  const reason = String(
    errBody.status ||
      errBody.errors?.[0]?.reason ||
      errBody.reason ||
      '',
  );
  const err = Object.assign(new Error(message), {
    gmailStatus: status,
    reason,
    details: payload,
    status:
      status === 401
        ? 401
        : status === 429 || (status === 403 && /quota|rate/i.test(message + reason))
          ? 429
          : status === 400
            ? 400
            : 502,
  });
  return err;
}

/**
 * Low-level Gmail fetch. Pass accountId to pace requests per mailbox.
 * Retries only retryable 403/429/5xx via the account limiter — never 400.
 */
export async function gmailFetch(
  accessToken,
  path,
  options = {},
  { accountId = '' } = {},
) {
  const limiter = getAccountLimiter(accountId || accessToken?.slice?.(-12) || 'default');
  const execute = async () => {
    const response = await fetch(`${GMAIL_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = gmailErrorFromResponse(response.status, payload);
      if (isQuotaError(err)) limiter.markQuotaCooldown();
      if (isMalformedGmailError(err)) {
        // Do not retry malformed requests.
        err.retryable = false;
      }
      throw err;
    }
    return payload;
  };

  return limiter.withBackoff(execute);
}

export function decodeBase64Url(data = '') {
  const normalized = String(data).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function headerValue(headers = [], name) {
  const found = headers.find(
    (h) => String(h.name || '').toLowerCase() === name.toLowerCase(),
  );
  return found?.value || '';
}

function walkParts(
  part,
  acc = { text: '', html: '', attachments: [] },
  depth = 0,
) {
  if (!part) return acc;
  const mime = String(part.mimeType || '');
  const filename = String(part.filename || '').trim();
  if (filename && part.body?.attachmentId) {
    acc.attachments.push({
      attachmentId: part.body.attachmentId,
      filename,
      mimeType: mime || 'application/octet-stream',
      size: Number(part.body.size || 0),
    });
  }
  if (mime === 'text/plain' && part.body?.data && !acc.text) {
    acc.text = decodeBase64Url(part.body.data);
  }
  if (mime === 'text/html' && part.body?.data && !acc.html) {
    acc.html = decodeBase64Url(part.body.data);
  }
  for (const child of part.parts || []) walkParts(child, acc, depth + 1);
  return acc;
}

export function parseGmailMessage(message) {
  const headers = message.payload?.headers || [];
  const bodies = walkParts(message.payload || {});
  const labelIds = message.labelIds || [];
  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    historyId: message.historyId || '',
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    cc: headerValue(headers, 'Cc'),
    subject: headerValue(headers, 'Subject'),
    date: headerValue(headers, 'Date'),
    snippet: message.snippet || '',
    bodyText: bodies.text,
    bodyHtml: bodies.html,
    labelIds,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    hasAttachments: bodies.attachments.length > 0,
    attachments: bodies.attachments,
    internalDate: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : null,
    rawHeaders: Object.fromEntries(headers.map((h) => [h.name, h.value])),
  };
}

export async function listLabels(accessToken, { accountId = '' } = {}) {
  const data = await gmailFetch(accessToken, '/users/me/labels', {}, { accountId });
  return data?.labels || [];
}

export async function listThreads(
  accessToken,
  { labelIds = null, q = '', pageToken = '', maxResults = 40 } = {},
  { accountId = '' } = {},
) {
  const params = new URLSearchParams({
    maxResults: String(Math.min(100, Math.max(1, maxResults))),
  });
  // Only add labelIds when explicitly provided. Do not default to INBOX —
  // interview sync relies on `q` alone (e.g. newer_than + keyword group).
  if (Array.isArray(labelIds)) {
    for (const id of labelIds) {
      if (id) params.append('labelIds', id);
    }
  }
  if (q) params.set('q', q);
  if (pageToken) params.set('pageToken', pageToken);
  return gmailFetch(
    accessToken,
    `/users/me/threads?${params.toString()}`,
    {},
    { accountId },
  );
}

export async function getThread(
  accessToken,
  threadId,
  format = 'full',
  { accountId = '' } = {},
) {
  return gmailFetch(
    accessToken,
    `/users/me/threads/${encodeURIComponent(threadId)}?format=${encodeURIComponent(format)}`,
    {},
    { accountId },
  );
}

export async function getMessage(
  accessToken,
  messageId,
  format = 'full',
  { accountId = '' } = {},
) {
  return gmailFetch(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}?format=${encodeURIComponent(format)}`,
    {},
    { accountId },
  );
}

export async function getAttachment(
  accessToken,
  messageId,
  attachmentId,
  { accountId = '' } = {},
) {
  return gmailFetch(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {},
    { accountId },
  );
}

export async function getProfile(accessToken, { accountId = '' } = {}) {
  return gmailFetch(accessToken, '/users/me/profile', {}, { accountId });
}

export async function listHistory(
  accessToken,
  startHistoryId,
  { pageToken = '', accountId = '' } = {},
) {
  const start = String(startHistoryId || '').trim();
  if (!start || !/^\d+$/.test(start)) {
    throw Object.assign(
      new Error('Invalid Gmail startHistoryId (must be a numeric history id).'),
      { gmailStatus: 400, status: 400, retryable: false },
    );
  }
  const params = new URLSearchParams({
    startHistoryId: start,
    // Restrict history types to reduce payload/cost.
  });
  params.append('historyTypes', 'messageAdded');
  params.append('historyTypes', 'labelAdded');
  if (pageToken) params.set('pageToken', pageToken);
  return gmailFetch(
    accessToken,
    `/users/me/history?${params.toString()}`,
    {},
    { accountId },
  );
}

export async function startMailboxWatch(
  accessToken,
  topicName,
  { accountId = '' } = {},
) {
  return gmailFetch(
    accessToken,
    '/users/me/watch',
    {
      method: 'POST',
      body: JSON.stringify({
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      }),
    },
    { accountId },
  );
}

/** Lightweight keyword check for history-driven candidates (q already applied on full sync). */
export function matchesInterviewMailKeywords({
  subject = '',
  snippet = '',
  bodyText = '',
} = {}) {
  const hay = `${subject}\n${snippet}\n${bodyText}`.toLowerCase();
  if (!hay.trim()) return false;
  const needles = [
    'interview',
    'assessment',
    'recruiter',
    'next steps',
    'schedule a call',
    'book a time',
    'technical interview',
    'coding challenge',
    'shortlisted',
    'calendly',
  ];
  return needles.some((n) => hay.includes(n));
}

export function extractEmailAddress(value = '') {
  const match = String(value).match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  const bare = String(value).trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare)) return bare.toLowerCase();
  return '';
}

const EMAIL_IN_TEXT =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;

function headerLookup(rawHeaders = {}, name) {
  if (!rawHeaders) return '';
  if (rawHeaders[name]) return String(rawHeaders[name]);
  const lower = name.toLowerCase();
  if (rawHeaders[lower]) return String(rawHeaders[lower]);
  const entry = Object.entries(rawHeaders).find(
    ([key]) => String(key).toLowerCase() === lower,
  );
  return entry ? String(entry[1] || '') : '';
}

function pushEmailCandidate(map, value, weight) {
  const parts = String(value || '').split(/[,;]/);
  for (const part of parts) {
    const email =
      extractEmailAddress(part) || String(part || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    map.set(email, Math.max(map.get(email) || 0, weight));
  }
}

/**
 * Weighted email candidates that identify which team member forwarded
 * (or originally received) interview mail into the central inbox.
 *
 * Higher weight = more trustworthy (forwarding headers >> body scrape).
 * Returns Map<email, weight>.
 */
export function collectForwardMatchEmailWeights({
  from = '',
  to = '',
  cc = '',
  subject = '',
  bodyText = '',
  rawHeaders = {},
} = {}) {
  const weights = new Map();

  // Gmail auto-forward / alias headers — strongest signal for original owner.
  const highHeaders = [
    'X-Forwarded-For',
    'X-Forwarded-To',
    'X-Original-To',
    'X-Original-Recipient',
    'Original-Recipient',
    'X-Envelope-To',
    'Envelope-To',
    'Apparently-To',
  ];
  for (const key of highHeaders) {
    pushEmailCandidate(weights, headerLookup(rawHeaders, key), 12);
  }

  // Who forwarded / resent into the central inbox.
  const forwarderHeaders = [
    'X-Original-From',
    'X-Forwarded-From',
    'Resent-From',
    'Sender',
  ];
  for (const key of forwarderHeaders) {
    pushEmailCandidate(weights, headerLookup(rawHeaders, key), 10);
  }

  // Delivered-To is usually the central inbox — keep low weight only.
  pushEmailCandidate(weights, headerLookup(rawHeaders, 'Delivered-To'), 2);
  pushEmailCandidate(weights, headerLookup(rawHeaders, 'X-Gmail-Forward'), 8);

  // Outer From/To/Cc (after forward, From is often the recruiter; To is central).
  pushEmailCandidate(weights, from, 9);
  String(to || '')
    .split(',')
    .forEach((part) => pushEmailCandidate(weights, part, 4));
  String(cc || '')
    .split(',')
    .forEach((part) => pushEmailCandidate(weights, part, 3));
  pushEmailCandidate(weights, headerLookup(rawHeaders, 'Reply-To'), 3);

  const hay = `${subject}\n${bodyText || ''}`;

  // Classic Gmail "Forwarded message" / Outlook forward blocks.
  const toLine = /(?:^|\n)\s*To:\s*(.+?)(?:\n|$)/gi;
  let match;
  while ((match = toLine.exec(hay))) {
    pushEmailCandidate(weights, match[1], 11);
  }
  const fromLine = /(?:^|\n)\s*From:\s*(.+?)(?:\n|$)/gi;
  while ((match = fromLine.exec(hay))) {
    pushEmailCandidate(weights, match[1], 8);
  }
  const deliveredLine =
    /(?:^|\n)\s*(?:X-Original-To|X-Forwarded-To|Delivered-To):\s*(.+?)(?:\n|$)/gi;
  while ((match = deliveredLine.exec(hay))) {
    pushEmailCandidate(weights, match[1], 12);
  }

  // Last resort: any bare email in body/subject (very low weight — avoid wrong member).
  for (const hit of hay.match(EMAIL_IN_TEXT) || []) {
    pushEmailCandidate(weights, hit, 1);
  }

  return weights;
}

/**
 * @deprecated Prefer collectForwardMatchEmailWeights for scoring.
 * Returns unique emails (unweighted) for any leftover callers.
 */
export function collectForwardMatchEmails(input = {}) {
  return [...collectForwardMatchEmailWeights(input).keys()];
}

/**
 * @deprecated Sync must filter via Gmail `q` (buildInterviewMailQuery), not after fetch.
 * Kept as a no-op true for any leftover callers.
 */
export function looksLikeInterviewMail() {
  return true;
}
