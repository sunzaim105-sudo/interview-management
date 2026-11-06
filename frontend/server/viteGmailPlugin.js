import fs from 'node:fs';
import nodePath from 'node:path';
import { loadEnv } from 'vite';
import {
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  extractEmailAddress,
  fetchGoogleUserInfo,
  getAttachment,
  getGmailOAuthConfig,
  getProfile,
  getThread,
  INTERVIEW_MAIL_BASE_QUERY,
  listHistory,
  listThreads,
  matchesInterviewMailKeywords,
  parseGmailMessage,
  refreshAccessToken,
  startMailboxWatch,
} from './gmailClient.js';
import {
  getAccountLimiter,
  isQuotaError,
  tryAcquireSyncLock,
} from './gmailRateLimit.js';
import { withGoogleEnvFile } from './googleOAuthConfig.js';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  verifyOAuthState,
} from './tokenCrypto.js';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function getEnv(mode) {
  return withGoogleEnvFile(loadEnv(mode, process.cwd(), ''));
}

function getBearer(req, body = {}) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return body.accessToken || '';
}

function serviceClient(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(
      new Error(
        'Set SUPABASE_SECRET_KEY in frontend/.env for Gmail token storage.',
      ),
      { status: 500 },
    );
  }
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  };
}

async function sb(env, path, options = {}) {
  const { url, headers } = serviceClient(env);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      data?.message || data?.error_description || data?.error || text || 'Supabase error';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function assertAppUser(env, accessToken) {
  if (!accessToken) {
    throw Object.assign(new Error('Missing access token.'), { status: 401 });
  }
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    throw Object.assign(new Error('Supabase env is not configured.'), {
      status: 500,
    });
  }

  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}` },
  });
  const authUser = await userRes.json().catch(() => ({}));
  if (!userRes.ok || !authUser?.id) {
    throw Object.assign(new Error('Invalid session.'), { status: 401 });
  }

  const profiles = await sb(
    env,
    `users?id=eq.${authUser.id}&select=id,user_role,status,email,username`,
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || profile.status !== 'allowed') {
    throw Object.assign(new Error('Account is not allowed.'), { status: 403 });
  }
  return profile;
}

function isMailAdmin(profile) {
  return profile?.user_role === 'admin';
}

function canReadMailBox(profile) {
  return isMailAdmin(profile) || profile?.user_role === 'team_member';
}

function assertMailAdmin(profile) {
  if (!isMailAdmin(profile)) {
    throw Object.assign(
      new Error('Only admins can change Mail or Gmail connections.'),
      { status: 403 },
    );
  }
}

async function loadTeamMembers(env) {
  const rows = await sb(
    env,
    'teammembers?select=id,name,email,professional_title&order=name',
  );
  return Array.isArray(rows) ? rows : [];
}

async function loadMemberAccounts(env) {
  const rows = await sb(
    env,
    'gmail_accounts?account_kind=eq.member&select=id,account_kind,team_member_id,gmail_address,status,history_id,last_sync_at,last_error,watch_expiration,connected_by,created_at,team:teammembers!gmail_accounts_team_member_id_fkey(id,name,email)&order=created_at',
  );
  return Array.isArray(rows) ? rows : [];
}

async function patchAccount(env, accountId, fields) {
  await sb(env, `gmail_accounts?id=eq.${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

function accountHasAuth(account) {
  return account && account.status !== 'revoked';
}

function isRecentQuotaCooldown(account) {
  if (!account?.last_error || !isQuotaError({ message: account.last_error })) {
    return false;
  }
  if (!account.last_sync_at) return false;
  const age = Date.now() - new Date(account.last_sync_at).getTime();
  return age >= 0 && age < 60_000;
}

/** In-memory full-sync page tokens (also mirrored to gmail_accounts.history checkpoint). */
const fullSyncCursors = new Map();

async function findTeamMemberById(env, teamMemberId) {
  const rows = await sb(
    env,
    `teammembers?id=eq.${teamMemberId}&select=id,name,email,professional_title`,
  );
  return Array.isArray(rows) ? rows[0] : null;
}

function emailsMatch(a, b) {
  return (
    String(a || '').trim().toLowerCase() ===
    String(b || '').trim().toLowerCase()
  );
}

/** Only admins may connect / reconnect / disconnect Gmail accounts. */
function canConnectMember(profile, member) {
  if (!member?.email) return false;
  return isMailAdmin(profile);
}

async function getAccountAccessToken(env, accountId) {
  const cfg = getGmailOAuthConfig(env);
  const secrets = await sb(
    env,
    `gmail_account_secrets?gmail_account_id=eq.${accountId}&select=*`,
  );
  const secret = Array.isArray(secrets) ? secrets[0] : null;
  if (!secret?.refresh_token_enc) {
    throw Object.assign(
      new Error('Gmail account is missing OAuth credentials. Reconnect Gmail.'),
      { status: 400 },
    );
  }

  const refreshToken = decryptSecret(secret.refresh_token_enc, cfg.tokenSecret);
  const now = Date.now();
  if (
    secret.access_token_enc &&
    secret.access_token_expires_at &&
    new Date(secret.access_token_expires_at).getTime() > now + 60_000
  ) {
    return decryptSecret(secret.access_token_enc, cfg.tokenSecret);
  }

  const refreshed = await refreshAccessToken(env, refreshToken);
  const expiresAt = new Date(
    Date.now() + Number(refreshed.expires_in || 3600) * 1000,
  ).toISOString();
  await sb(env, `gmail_account_secrets?gmail_account_id=eq.${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token_enc: encryptSecret(refreshed.access_token, cfg.tokenSecret),
      access_token_expires_at: expiresAt,
      ...(refreshed.refresh_token
        ? {
            refresh_token_enc: encryptSecret(
              refreshed.refresh_token,
              cfg.tokenSecret,
            ),
          }
        : {}),
    }),
  });
  return refreshed.access_token;
}

async function matchInterviewId(env, account, { subject, participants }) {
  const memberId = account.team_member_id || null;
  const interviewPath = memberId
    ? `interviews?invited_member_id=eq.${memberId}&select=id,interview_name,meeting_link,start_time,caller:users!interviews_caller_id_fkey(email),invited_member:teammembers!interviews_invited_member_id_fkey(email),job:jobs!interviews_job_id_fkey(job_title,company_name)&order=start_time.desc&limit=80`
    : `interviews?select=id,interview_name,meeting_link,start_time,caller:users!interviews_caller_id_fkey(email),invited_member:teammembers!interviews_invited_member_id_fkey(email),job:jobs!interviews_job_id_fkey(job_title,company_name)&order=start_time.desc&limit=120`;
  const interviews = await sb(env, interviewPath);
  if (!Array.isArray(interviews) || !interviews.length) return null;

  const subjectLower = String(subject || '').toLowerCase();
  const people = new Set(
    (participants || []).map((p) => String(p).toLowerCase()).filter(Boolean),
  );

  let best = null;
  let bestScore = 0;
  for (const interview of interviews) {
    let score = 0;
    const name = String(interview.interview_name || '').toLowerCase();
    if (name && subjectLower.includes(name)) score += 5;
    if (
      name &&
      name.split(/\s+/).some((w) => w.length > 3 && subjectLower.includes(w))
    ) {
      score += 2;
    }
    const company = String(interview.job?.company_name || '').toLowerCase();
    const title = String(interview.job?.job_title || '').toLowerCase();
    if (company && subjectLower.includes(company)) score += 3;
    if (title && subjectLower.includes(title)) score += 2;
    const callerEmail = String(interview.caller?.email || '').toLowerCase();
    if (callerEmail && people.has(callerEmail)) score += 3;
    const member = String(interview.invited_member?.email || '').toLowerCase();
    if (member && people.has(member)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = interview.id;
    }
  }
  return bestScore >= 3 ? best : null;
}

async function upsertSyncedThread(env, account, parsedMessages) {
  if (!parsedMessages.length) return null;
  const newest = parsedMessages[parsedMessages.length - 1];
  const participants = [
    ...new Set(
      parsedMessages
        .flatMap((m) => [m.from, m.to, m.cc])
        .flatMap((v) =>
          String(v || '')
            .split(',')
            .map((part) => extractEmailAddress(part) || part.trim())
            .filter(Boolean),
        ),
    ),
  ];

  const labelIds = [
    ...new Set(parsedMessages.flatMap((m) => m.labelIds || [])),
  ];
  const matchedTeamMemberId = account.team_member_id || null;
  const interviewId = await matchInterviewId(env, account, {
    subject: newest.subject,
    participants,
  });

  const threadRows = await sb(
    env,
    `mail_threads?gmail_account_id=eq.${account.id}&gmail_thread_id=eq.${newest.gmailThreadId}&select=id,interview_id,is_unread,is_starred,label_ids,matched_team_member_id`,
  );
  const existing = Array.isArray(threadRows) ? threadRows[0] : null;
  const gmailUnread = labelIds.includes('UNREAD');
  const existingLabels = Array.isArray(existing?.label_ids)
    ? existing.label_ids
    : [];
  const mergedLabels = existingLabels.includes('APP_TRASH')
    ? [...new Set([...labelIds.filter((id) => id !== 'INBOX'), 'APP_TRASH'])]
    : labelIds;

  const threadPayload = {
    gmail_account_id: account.id,
    gmail_thread_id: newest.gmailThreadId,
    subject: newest.subject || '(no subject)',
    snippet: newest.snippet || '',
    participants,
    label_ids: mergedLabels,
    is_unread: existing && existing.is_unread === false ? false : gmailUnread,
    is_starred: existing
      ? Boolean(existing.is_starred)
      : labelIds.includes('STARRED'),
    last_message_at: newest.internalDate,
    interview_id: existing?.interview_id || interviewId || null,
    matched_team_member_id: matchedTeamMemberId,
  };

  let threadId = existing?.id;
  if (existing) {
    await sb(env, `mail_threads?id=eq.${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(threadPayload),
    });
  } else {
    const inserted = await sb(env, 'mail_threads', {
      method: 'POST',
      body: JSON.stringify(threadPayload),
    });
    threadId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
  }

  for (const message of parsedMessages) {
    const row = {
      gmail_account_id: account.id,
      thread_id: threadId,
      gmail_message_id: message.gmailMessageId,
      gmail_thread_id: message.gmailThreadId,
      from_header: message.from,
      to_header: message.to,
      cc_header: message.cc,
      subject: message.subject,
      snippet: message.snippet,
      body_text: message.bodyText || '',
      body_html: message.bodyHtml || '',
      label_ids: message.labelIds,
      internal_date: message.internalDate,
      has_attachments: message.hasAttachments,
      raw_headers: {
        ...(message.rawHeaders || {}),
        __attachments: message.attachments || [],
      },
    };
    await sb(
      env,
      `mail_messages?on_conflict=gmail_account_id,gmail_message_id`,
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      },
    );
  }

  return threadId;
}

async function loadExistingThreadMeta(env, accountId, gmailThreadIds) {
  if (!gmailThreadIds.length) return new Map();
  const chunkSize = 40;
  const map = new Map();
  for (let i = 0; i < gmailThreadIds.length; i += chunkSize) {
    const chunk = gmailThreadIds.slice(i, i + chunkSize);
    const rows = await sb(
      env,
      `mail_threads?gmail_account_id=eq.${accountId}&gmail_thread_id=in.(${chunk.join(',')})&select=id,gmail_thread_id,snippet,last_message_at`,
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      map.set(row.gmail_thread_id, row);
    }
  }
  return map;
}

async function fetchAndUpsertThread(env, account, accessToken, threadId) {
  const full = await getThread(accessToken, threadId, 'full', {
    accountId: account.id,
  });
  const parsed = (full?.messages || []).map(parseGmailMessage);
  if (!parsed.length) return null;
  return upsertSyncedThread(env, account, parsed);
}

/**
 * Incremental sync via Gmail history.historyId checkpoint.
 * Falls back (returns { stale: true }) when history is too old / invalid.
 */
async function collectHistoryThreadIds(accessToken, account) {
  const startHistoryId = String(account.history_id || '').trim();
  if (!startHistoryId || !/^\d+$/.test(startHistoryId)) {
    return { stale: true, threadIds: [], historyId: startHistoryId };
  }

  const threadIds = new Set();
  let pageToken = '';
  let latestHistoryId = startHistoryId;
  let pages = 0;

  try {
    do {
      const page = await listHistory(accessToken, startHistoryId, {
        pageToken,
        accountId: account.id,
      });
      latestHistoryId = String(page?.historyId || latestHistoryId);
      for (const entry of page?.history || []) {
        for (const added of entry.messagesAdded || []) {
          const tid = added?.message?.threadId;
          if (tid) threadIds.add(tid);
        }
        for (const labeled of entry.labelsAdded || []) {
          const tid = labeled?.message?.threadId;
          if (tid) threadIds.add(tid);
        }
        for (const msg of entry.messages || []) {
          if (msg?.threadId) threadIds.add(msg.threadId);
        }
      }
      pageToken = page?.nextPageToken || '';
      pages += 1;
    } while (pageToken && pages < 10);
  } catch (err) {
    const status = Number(err?.gmailStatus || err?.status || 0);
    const message = String(err?.message || '').toLowerCase();
    // History id too old / unknown — caller should run a bounded list sync.
    if (
      status === 404 ||
      status === 410 ||
      message.includes('starthistoryid') ||
      message.includes('history')
    ) {
      return { stale: true, threadIds: [], historyId: startHistoryId };
    }
    throw err;
  }

  return {
    stale: false,
    threadIds: [...threadIds],
    historyId: latestHistoryId,
  };
}

async function syncAccount(
  env,
  account,
  {
    full = false,
    maxThreads = 40,
    pageToken: requestedPageToken = '',
    force = false,
  } = {},
) {
  if (!accountHasAuth(account)) {
    throw Object.assign(new Error('Gmail account is revoked.'), { status: 400 });
  }

  if (!force && isRecentQuotaCooldown(account)) {
    return {
      accountId: account.id,
      teamMemberId: account.team_member_id,
      gmailAddress: account.gmail_address,
      syncedThreads: 0,
      skipped: true,
      mode: 'cooldown',
      hasMore: Boolean(fullSyncCursors.get(account.id)),
      query: INTERVIEW_MAIL_BASE_QUERY,
      error: account.last_error || 'Gmail quota cooldown — retry shortly.',
      success: false,
    };
  }

  const lock = tryAcquireSyncLock(account.id);
  if (!lock.ok) {
    return {
      accountId: account.id,
      teamMemberId: account.team_member_id,
      gmailAddress: account.gmail_address,
      syncedThreads: 0,
      skipped: true,
      mode: 'locked',
      hasMore: false,
      query: INTERVIEW_MAIL_BASE_QUERY,
      error: lock.reason,
      success: false,
    };
  }

  const limiter = getAccountLimiter(account.id);
  const q = INTERVIEW_MAIL_BASE_QUERY;
  let synced = 0;
  let skippedExisting = 0;
  let lastError = '';
  let mode = full ? 'full' : 'incremental';
  let hasMore = false;
  let nextPageToken = '';
  let historyId = String(account.history_id || '');
  let quotaHit = false;

  try {
    const accessToken = await getAccountAccessToken(env, account.id);
    const profile = await getProfile(accessToken, { accountId: account.id });
    historyId = String(profile?.historyId || historyId);

    const threadIdsToFetch = [];

    if (!full && account.history_id) {
      const hist = await collectHistoryThreadIds(accessToken, account);
      if (!hist.stale) {
        mode = 'history';
        historyId = hist.historyId || historyId;
        // Cheap metadata filter: only pull threads that look interview-related
        // or are not yet cached (history includes all mailbox noise).
        const existing = await loadExistingThreadMeta(
          env,
          account.id,
          hist.threadIds,
        );
        for (const threadId of hist.threadIds.slice(0, maxThreads)) {
          if (!existing.has(threadId)) {
            threadIdsToFetch.push(threadId);
            continue;
          }
          // Already cached — refresh only up to a small budget.
          if (threadIdsToFetch.length < Math.min(10, maxThreads)) {
            threadIdsToFetch.push(threadId);
          } else {
            skippedExisting += 1;
          }
        }
      } else {
        mode = 'incremental';
      }
    }

    if (mode !== 'history') {
      const pageSize = Math.min(25, Math.max(5, maxThreads));
      let pageToken =
        requestedPageToken ||
        (full ? fullSyncCursors.get(account.id) || '' : '');
      if (full && requestedPageToken === '' && !fullSyncCursors.has(account.id)) {
        pageToken = '';
      }
      const listed = await listThreads(
        accessToken,
        {
          labelIds: null,
          q,
          pageToken,
          maxResults: pageSize,
        },
        { accountId: account.id },
      );
      const refs = listed?.threads || [];
      nextPageToken = listed?.nextPageToken || '';
      hasMore = Boolean(nextPageToken);
      if (full) {
        if (nextPageToken) fullSyncCursors.set(account.id, nextPageToken);
        else fullSyncCursors.delete(account.id);
      }

      const existing = await loadExistingThreadMeta(
        env,
        account.id,
        refs.map((r) => r.id).filter(Boolean),
      );

      for (const item of refs) {
        if (!item?.id) continue;
        const cached = existing.get(item.id);
        // Deduplicate: skip unchanged cached threads on incremental sync.
        if (
          !full &&
          cached &&
          cached.snippet &&
          item.snippet &&
          cached.snippet === item.snippet
        ) {
          skippedExisting += 1;
          continue;
        }
        threadIdsToFetch.push(item.id);
        if (threadIdsToFetch.length >= maxThreads) break;
      }

      if (full && hasMore && threadIdsToFetch.length >= maxThreads) {
        hasMore = true;
      }
    }

    // History candidates may include non-interview mail — filter after metadata get when needed.
    for (const threadId of threadIdsToFetch) {
      if (limiter.inCooldown()) {
        quotaHit = true;
        lastError =
          'Quota exceeded for Gmail API (units per minute). Sync paused; progress saved.';
        break;
      }
      try {
        if (mode === 'history') {
          // Fetch metadata first to avoid burning quota on unrelated mail.
          const meta = await getThread(accessToken, threadId, 'metadata', {
            accountId: account.id,
          });
          const metaParsed = (meta?.messages || []).map(parseGmailMessage);
          const newest = metaParsed[metaParsed.length - 1] || metaParsed[0];
          const existing = await loadExistingThreadMeta(env, account.id, [
            threadId,
          ]);
          const known = existing.has(threadId);
          if (
            !known &&
            !matchesInterviewMailKeywords({
              subject: newest?.subject,
              snippet: newest?.snippet,
            })
          ) {
            skippedExisting += 1;
            continue;
          }
        }
        const saved = await fetchAndUpsertThread(
          env,
          account,
          accessToken,
          threadId,
        );
        if (saved) synced += 1;
      } catch (err) {
        lastError = err.message || 'Thread sync failed';
        if (isQuotaError(err)) {
          quotaHit = true;
          limiter.markQuotaCooldown();
          break;
        }
        // Non-quota thread errors: keep going, but record the last error.
      }
    }

    // Auth tokens stay valid. status=error only for quota / total sync failure.
    const totalFail =
      Boolean(lastError) && synced === 0 && threadIdsToFetch.length > 0;
    const nextStatus = quotaHit || totalFail ? 'error' : 'connected';

    await patchAccount(env, account.id, {
      history_id: historyId,
      last_sync_at: new Date().toISOString(),
      last_error: lastError || '',
      status: nextStatus,
    });

    return {
      accountId: account.id,
      teamMemberId: account.team_member_id,
      gmailAddress: account.gmail_address,
      syncedThreads: synced,
      skippedExisting,
      mode,
      hasMore: hasMore || (full && fullSyncCursors.has(account.id)),
      nextPageToken: full ? fullSyncCursors.get(account.id) || '' : nextPageToken,
      historyId,
      query: q,
      error: lastError || null,
      success: !quotaHit && !totalFail,
      quotaPaused: quotaHit,
    };
  } catch (err) {
    const message = err.message || 'Sync failed';
    if (isQuotaError(err)) {
      getAccountLimiter(account.id).markQuotaCooldown();
    }
    await patchAccount(env, account.id, {
      last_sync_at: new Date().toISOString(),
      last_error: message,
      status: 'error',
    }).catch(() => {});
    return {
      accountId: account.id,
      teamMemberId: account.team_member_id,
      gmailAddress: account.gmail_address,
      syncedThreads: synced,
      mode,
      hasMore: full && fullSyncCursors.has(account.id),
      nextPageToken: full ? fullSyncCursors.get(account.id) || '' : '',
      historyId,
      query: q,
      error: message,
      success: false,
      quotaPaused: isQuotaError(err),
    };
  } finally {
    lock.release();
  }
}

async function syncAllAccounts(env, { full = false, resume = true } = {}) {
  const accounts = await loadMemberAccounts(env);
  const connected = accounts.filter((a) => a.status !== 'revoked');
  const results = [];

  for (const account of connected) {
    // Independent per-account pacing/cooldowns — never share limiters across mailboxes.
    const result = await syncAccount(env, account, {
      full,
      maxThreads: full ? 30 : 20,
      pageToken: full && resume ? fullSyncCursors.get(account.id) || '' : '',
      force: false,
    });
    results.push(result);

    // Full sync: keep pulling pages for this account until done or quota pause.
    if (full && result.hasMore && !result.quotaPaused && result.success !== false) {
      let guard = 0;
      while (guard < 8) {
        guard += 1;
        const more = await syncAccount(env, account, {
          full: true,
          maxThreads: 30,
          pageToken: fullSyncCursors.get(account.id) || '',
          force: false,
        });
        results[results.length - 1] = {
          ...more,
          syncedThreads:
            (results[results.length - 1].syncedThreads || 0) +
            (more.syncedThreads || 0),
          skippedExisting:
            (results[results.length - 1].skippedExisting || 0) +
            (more.skippedExisting || 0),
        };
        if (!more.hasMore || more.quotaPaused || more.success === false) break;
      }
    }
  }

  const errors = results.filter((row) => row.error && !row.skipped);
  return {
    accounts: results.length,
    syncedThreads: results.reduce(
      (sum, row) => sum + (row.syncedThreads || 0),
      0,
    ),
    results,
    query: INTERVIEW_MAIL_BASE_QUERY,
    success: errors.length === 0,
    errorCount: errors.length,
  };
}

function buildConnectionStatuses(members, accounts) {
  const byMember = new Map(
    accounts.map((account) => [account.team_member_id, account]),
  );
  return (members || []).map((member) => {
    const account = byMember.get(member.id) || null;
    const rawStatus = account?.status || 'disconnected';
    const lastError = account?.last_error || '';
    const hasAuth =
      Boolean(account) &&
      rawStatus !== 'revoked' &&
      rawStatus !== 'disconnected';
    // Auth verified (tokens stored). Sync problems use status=error + lastError.
    const connected = hasAuth && (rawStatus === 'connected' || rawStatus === 'error');
    const syncState = !account
      ? 'disconnected'
      : rawStatus === 'revoked'
        ? 'revoked'
        : lastError
          ? isQuotaError({ message: lastError })
            ? 'quota_paused'
            : 'sync_error'
          : rawStatus === 'connected'
            ? 'ok'
            : rawStatus;
    return {
      teamMemberId: member.id,
      name: member.name,
      email: member.email,
      connected,
      status: rawStatus === 'disconnected' ? 'disconnected' : rawStatus,
      syncState,
      gmailAddress: account?.gmail_address || '',
      accountId: account?.id || null,
      lastSyncAt: account?.last_sync_at || null,
      lastError,
    };
  });
}

export function gmailPlugin() {
  return {
    name: 'gmail-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const env = getEnv(server.config.mode);
        const rawUrl = req.url || '';
        const path = rawUrl.split('?')[0];
        if (!path.startsWith('/api/gmail')) {
          next();
          return;
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        try {
          if (path === '/api/gmail/oauth/start' && req.method === 'GET') {
            const query = new URL(rawUrl, 'http://localhost').searchParams;
            const accessToken = query.get('accessToken') || getBearer(req);
            const profile = await assertAppUser(env, accessToken);
            const teamMemberId = query.get('teamMemberId') || '';
            if (!teamMemberId) {
              sendJson(res, 400, {
                error: 'teamMemberId is required to connect a Gmail account.',
              });
              return;
            }

            const member = await findTeamMemberById(env, teamMemberId);
            if (!member) {
              sendJson(res, 404, { error: 'Team member not found.' });
              return;
            }
            if (!canConnectMember(profile, member)) {
              sendJson(res, 403, {
                error:
                  'Only admins can connect Gmail accounts. Team members have read-only access.',
              });
              return;
            }
            if (!member.email) {
              sendJson(res, 400, {
                error: 'Add an email on the Team page before connecting Gmail.',
              });
              return;
            }

            const cfg = getGmailOAuthConfig(env);
            const returnTo = query.get('returnTo') || '/dashboard/settings';
            const state = signOAuthState(
              {
                ts: Date.now(),
                kind: 'member',
                userId: profile.id,
                teamMemberId: member.id,
                expectedEmail: String(member.email).toLowerCase(),
                returnTo,
              },
              cfg.tokenSecret,
            );
            const authUrl = buildGmailAuthUrl({
              clientId: cfg.clientId,
              redirectUri: cfg.redirectUri,
              state,
              loginHint: member.email,
              env,
            });
            if (query.get('json') === '1') {
              sendJson(res, 200, { data: { authUrl } });
              return;
            }
            redirect(res, authUrl);
            return;
          }

          if (path === '/api/gmail/oauth/callback' && req.method === 'GET') {
            const query = new URL(rawUrl, 'http://localhost').searchParams;
            const cfg = getGmailOAuthConfig(env);
            const err = query.get('error');
            if (err) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(err)}`,
              );
              return;
            }
            const code = query.get('code');
            const statePayload = verifyOAuthState(
              query.get('state'),
              cfg.tokenSecret,
            );

            // Drive Connect reuses this registered redirect URI (admin-only).
            if (statePayload.kind === 'drive') {
              if (!statePayload.userId) {
                redirect(
                  res,
                  `${cfg.appOrigin}/dashboard/report?drive_error=${encodeURIComponent(
                    'Invalid Drive OAuth state. Only an admin can Connect Drive.',
                  )}`,
                );
                return;
              }
              try {
                const adminRows = await sb(
                  env,
                  `users?id=eq.${statePayload.userId}&select=id,user_role,status`,
                );
                const admin = Array.isArray(adminRows) ? adminRows[0] : null;
                if (
                  !admin ||
                  admin.user_role !== 'admin' ||
                  admin.status !== 'allowed'
                ) {
                  throw new Error('Admin access required.');
                }
              } catch {
                redirect(
                  res,
                  `${cfg.appOrigin}/dashboard/report?drive_error=${encodeURIComponent(
                    'Only an allowed admin can Connect Google Drive.',
                  )}`,
                );
                return;
              }

              const tokens = await exchangeCodeForTokens(env, code);
              if (!tokens.refresh_token) {
                redirect(
                  res,
                  `${cfg.appOrigin}/dashboard/report?drive_error=${encodeURIComponent(
                    'No refresh token returned. Revoke InterviewManagement access in Google Account and connect again.',
                  )}`,
                );
                return;
              }
              const envPath = nodePath.resolve(process.cwd(), '.env');
              const line = `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
              let text = fs.existsSync(envPath)
                ? fs.readFileSync(envPath, 'utf8')
                : '';
              if (/^GOOGLE_REFRESH_TOKEN=.*$/m.test(text)) {
                text = text.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line);
              } else {
                text = `${text.trimEnd()}\n${line}\n`;
              }
              fs.writeFileSync(envPath, text, 'utf8');
              env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
              process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/report?drive_connected=1`,
              );
              return;
            }

            if (statePayload.kind !== 'member' || !statePayload.teamMemberId) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'Invalid Gmail OAuth state. Start connect again from Settings.',
                )}`,
              );
              return;
            }

            try {
              const starterRows = await sb(
                env,
                `users?id=eq.${statePayload.userId}&select=id,user_role,status`,
              );
              const starter = Array.isArray(starterRows) ? starterRows[0] : null;
              if (
                !starter ||
                starter.user_role !== 'admin' ||
                starter.status !== 'allowed'
              ) {
                throw new Error('Admin access required.');
              }
            } catch {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'Only an allowed admin can connect Gmail accounts.',
                )}`,
              );
              return;
            }

            const tokens = await exchangeCodeForTokens(env, code);
            if (!tokens.access_token || !tokens.refresh_token) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'No refresh token returned. Revoke InterviewManagement in Google Account → Security → Third-party access, then connect again.',
                )}`,
              );
              return;
            }

            const info = await fetchGoogleUserInfo(tokens.access_token);
            const gmailAddress = String(info.email || '').toLowerCase();
            const expected = String(
              statePayload.expectedEmail || '',
            ).toLowerCase();
            if (!gmailAddress) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'Google account email was missing from OAuth response.',
                )}`,
              );
              return;
            }
            if (!expected || gmailAddress !== expected) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  `Signed in as ${gmailAddress}, but this team member is ${expected || 'unknown'}. Use that Google account.`,
                )}`,
              );
              return;
            }

            // Verify Gmail API access before marking connected or storing secrets.
            let gmailProfile;
            try {
              gmailProfile = await getProfile(tokens.access_token, {
                accountId: `oauth:${expected}`,
              });
              if (!gmailProfile || typeof gmailProfile !== 'object') {
                throw new Error('Gmail API returned an empty profile.');
              }
              const profileEmail = String(
                gmailProfile.emailAddress || '',
              ).toLowerCase();
              if (!profileEmail) {
                throw new Error(
                  'Gmail API did not return an email address for this account.',
                );
              }
              if (profileEmail !== expected) {
                throw new Error(
                  `Gmail profile email (${profileEmail}) does not match ${expected}.`,
                );
              }
            } catch (verifyErr) {
              const verifyMsg = isQuotaError(verifyErr)
                ? 'Gmail API quota exceeded during verification. Wait a minute and Connect again — do not spam Reconnect.'
                : verifyErr.message ||
                  'Gmail API verification failed. Grant gmail.readonly and try again.';
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(verifyMsg)}`,
              );
              return;
            }

            const member = await findTeamMemberById(
              env,
              statePayload.teamMemberId,
            );
            if (!member) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'Team member no longer exists.',
                )}`,
              );
              return;
            }
            if (!emailsMatch(member.email, expected)) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'Team member email changed during OAuth. Update Team email and reconnect.',
                )}`,
              );
              return;
            }

            const existing = await sb(
              env,
              `gmail_accounts?team_member_id=eq.${member.id}&select=id`,
            );
            let accountId = Array.isArray(existing) ? existing[0]?.id : null;
            const accountRow = {
              team_member_id: member.id,
              account_kind: 'member',
              gmail_address: gmailAddress,
              google_user_id: String(info.id || ''),
              history_id: String(gmailProfile?.historyId || ''),
              status: 'connected',
              last_error: '',
              connected_by: statePayload.userId,
            };

            if (accountId) {
              await sb(env, `gmail_accounts?id=eq.${accountId}`, {
                method: 'PATCH',
                body: JSON.stringify(accountRow),
              });
            } else {
              const inserted = await sb(env, 'gmail_accounts', {
                method: 'POST',
                body: JSON.stringify(accountRow),
              });
              accountId = Array.isArray(inserted)
                ? inserted[0]?.id
                : inserted?.id;
            }

            if (!accountId) {
              redirect(
                res,
                `${cfg.appOrigin}/dashboard/settings?gmail_error=${encodeURIComponent(
                  'Failed to save Gmail connection record.',
                )}`,
              );
              return;
            }

            await sb(env, 'gmail_account_secrets?on_conflict=gmail_account_id', {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({
                gmail_account_id: accountId,
                refresh_token_enc: encryptSecret(
                  tokens.refresh_token,
                  cfg.tokenSecret,
                ),
                access_token_enc: encryptSecret(
                  tokens.access_token,
                  cfg.tokenSecret,
                ),
                access_token_expires_at: new Date(
                  Date.now() + Number(tokens.expires_in || 3600) * 1000,
                ).toISOString(),
              }),
            });

            // Light bootstrap only — avoid burning per-user quota on OAuth redirect.
            let initialSyncError = '';
            try {
              const account = (
                await sb(env, `gmail_accounts?id=eq.${accountId}&select=*`)
              )?.[0];
              if (account) {
                fullSyncCursors.delete(accountId);
                const bootstrap = await syncAccount(env, account, {
                  full: true,
                  maxThreads: 15,
                  force: true,
                });
                if (bootstrap?.error) {
                  initialSyncError = bootstrap.error;
                }
              }
            } catch (syncErr) {
              // Keep OAuth tokens; surface sync failure accurately (not as Connected/ok).
              initialSyncError = syncErr.message || 'Initial sync failed';
              await patchAccount(env, accountId, {
                last_error: initialSyncError,
                status: 'error',
                last_sync_at: new Date().toISOString(),
              }).catch(() => {});
            }

            const topic = env.GMAIL_PUBSUB_TOPIC;
            if (topic) {
              try {
                const gmailToken = await getAccountAccessToken(env, accountId);
                const watch = await startMailboxWatch(gmailToken, topic, {
                  accountId,
                });
                await patchAccount(env, accountId, {
                  history_id: String(watch.historyId || ''),
                  watch_expiration: watch.expiration
                    ? new Date(Number(watch.expiration)).toISOString()
                    : null,
                });
              } catch {
                // Push optional
              }
            }

            const returnTo = String(
              statePayload.returnTo || '/dashboard/settings',
            );
            const safeReturn = returnTo.startsWith('/dashboard')
              ? returnTo
              : '/dashboard/settings';
            const qs = new URLSearchParams({
              accountId,
              teamMemberId: member.id,
            });
            if (initialSyncError) {
              qs.set('gmail_connected', '1');
              qs.set('gmail_sync_error', initialSyncError);
            } else {
              qs.set('gmail_connected', '1');
            }
            redirect(res, `${cfg.appOrigin}${safeReturn}?${qs.toString()}`);
            return;
          }

          if (path === '/api/gmail/pubsub' && req.method === 'POST') {
            const expected = String(
              env.GMAIL_PUBSUB_VERIFICATION_TOKEN || '',
            ).trim();
            const query = new URL(rawUrl, 'http://localhost').searchParams;
            const body = await readJsonBody(req);
            // Fail closed: never accept push without a configured shared secret.
            if (!expected || query.get('token') !== expected) {
              sendJson(res, 403, { error: 'Invalid pubsub token.' });
              return;
            }
            const message = body?.message;
            if (message?.data) {
              let decoded;
              try {
                decoded = JSON.parse(
                  Buffer.from(String(message.data), 'base64').toString('utf8'),
                );
              } catch {
                sendJson(res, 400, { error: 'Invalid pubsub message payload.' });
                return;
              }
              const emailAddress = String(
                decoded?.emailAddress || '',
              ).toLowerCase();
              if (!emailAddress) {
                sendJson(res, 200, { data: { ok: true } });
                return;
              }
              const accounts = await sb(
                env,
                `gmail_accounts?gmail_address=eq.${emailAddress}&account_kind=eq.member&select=*`,
              );
              const account = Array.isArray(accounts) ? accounts[0] : null;
              if (account) {
                await syncAccount(env, account, {
                  full: false,
                  maxThreads: 15,
                });
              }
            }
            sendJson(res, 200, { data: { ok: true } });
            return;
          }

          const body =
            req.method === 'GET' || req.method === 'HEAD'
              ? {}
              : await readJsonBody(req);
          const accessToken = getBearer(req, body);
          const profile = await assertAppUser(env, accessToken);

          // Settings connection status — admins and team members see all rows.
          if (path === '/api/gmail/connections' && req.method === 'GET') {
            if (!canReadMailBox(profile)) {
              sendJson(res, 403, {
                error: 'Only admins and team members can view Gmail connections.',
              });
              return;
            }
            const members = await loadTeamMembers(env);
            const accounts = await loadMemberAccounts(env);
            const connections = buildConnectionStatuses(members, accounts);
            sendJson(res, 200, {
              data: {
                connections,
                syncQuery: INTERVIEW_MAIL_BASE_QUERY,
                isAdmin: isMailAdmin(profile),
                canManage: isMailAdmin(profile),
              },
            });
            return;
          }

          const disconnectMemberEarly = path.match(
            /^\/api\/gmail\/connections\/([^/]+)$/,
          );
          if (disconnectMemberEarly && req.method === 'DELETE') {
            assertMailAdmin(profile);
            const teamMemberId = disconnectMemberEarly[1];
            const member = await findTeamMemberById(env, teamMemberId);
            if (!member) {
              sendJson(res, 404, { error: 'Team member not found.' });
              return;
            }
            if (!canConnectMember(profile, member)) {
              sendJson(res, 403, {
                error: 'You cannot disconnect this Gmail account.',
              });
              return;
            }
            const existing = await sb(
              env,
              `gmail_accounts?team_member_id=eq.${teamMemberId}&select=id`,
            );
            const accountId = Array.isArray(existing) ? existing[0]?.id : null;
            if (accountId) {
              await sb(env, `gmail_accounts?id=eq.${accountId}`, {
                method: 'DELETE',
              });
            }
            sendJson(res, 200, { data: { ok: true } });
            return;
          }

          // Mailbox APIs — admins manage; team members read-only.
          if (!canReadMailBox(profile)) {
            sendJson(res, 403, {
              error: 'Only admins and team members can access Mail.',
            });
            return;
          }

          if (path === '/api/gmail/accounts' && req.method === 'GET') {
            const accounts = await loadMemberAccounts(env);
            const members = await loadTeamMembers(env);
            const connections = buildConnectionStatuses(members, accounts);
            const manage = isMailAdmin(profile);
            sendJson(res, 200, {
              data: {
                accounts,
                teamMembers: members,
                connections,
                missingForwarding: [],
                syncQuery: INTERVIEW_MAIL_BASE_QUERY,
                isAdmin: manage,
                canManage: manage,
                canDelete: manage,
                canRead: true,
                mode: 'multi',
              },
            });
            return;
          }

          if (path === '/api/gmail/sync-all' && req.method === 'POST') {
            assertMailAdmin(profile);
            const result = await syncAllAccounts(env, {
              full: Boolean(body.full),
              resume: body.resume !== false,
            });
            const status = result.success ? 200 : 207;
            sendJson(res, status, { data: result });
            return;
          }

          if (path === '/api/gmail/threads' && req.method === 'GET') {
            const query = new URL(rawUrl, 'http://localhost').searchParams;
            const folder = query.get('folder') || 'inbox';
            const userQ = query.get('q') || '';
            const fromQ = (query.get('from') || '').trim().toLowerCase();
            const toQ = (query.get('to') || '').trim().toLowerCase();
            const subjectQ = (query.get('subject') || '').trim().toLowerCase();
            const hasWords = (query.get('hasWords') || '').trim().toLowerCase();
            const dateWithin = query.get('dateWithin') || '';
            const dateValue = query.get('date') || '';
            const unreadOnly = query.get('unread') === '1';
            const teamMemberId = query.get('teamMemberId') || '';
            const sort = query.get('sort') || 'date_desc';
            const page = Math.max(0, Number(query.get('page') || 0));
            const pageSize = Math.min(
              100,
              Math.max(10, Number(query.get('pageSize') || 40)),
            );

            const accounts = await loadMemberAccounts(env);
            let accountIds = accounts.map((a) => a.id);
            if (teamMemberId) {
              accountIds = accounts
                .filter((a) => a.team_member_id === teamMemberId)
                .map((a) => a.id);
            }
            if (!accountIds.length) {
              sendJson(res, 200, {
                data: {
                  threads: [],
                  page,
                  pageSize,
                  total: 0,
                  hasMore: false,
                  nextPageToken: '',
                  resultSizeEstimate: 0,
                },
              });
              return;
            }

            let filter = `gmail_account_id=in.(${accountIds.join(',')})`;
            if (unreadOnly) filter += '&is_unread=eq.true';
            if (folder === 'starred') filter += '&is_starred=eq.true';
            if (folder === 'inbox') filter += '&label_ids=cs.{INBOX}';
            else if (folder === 'sent') filter += '&label_ids=cs.{SENT}';

            const order =
              sort === 'date_asc'
                ? 'last_message_at.asc.nullslast'
                : sort === 'from_asc'
                  ? 'subject.asc'
                  : 'last_message_at.desc.nullslast';

            const fetchLimit = pageSize * 8;
            const cached = await sb(
              env,
              `mail_threads?${filter}&select=id,gmail_account_id,gmail_thread_id,subject,snippet,participants,is_unread,is_starred,last_message_at,interview_id,matched_team_member_id,label_ids,matched_member:teammembers!mail_threads_matched_team_member_id_fkey(id,name,email),account:gmail_accounts!mail_threads_gmail_account_id_fkey(id,gmail_address,team_member_id),interview:interviews!mail_threads_interview_id_fkey(id,interview_name,start_time)&order=${order}&limit=${fetchLimit}`,
            );

            const withinMs = (() => {
              const map = {
                '1d': 1,
                '3d': 3,
                '1w': 7,
                '2w': 14,
                '1m': 30,
                '2m': 60,
                '6m': 180,
                '1y': 365,
              };
              const days = map[dateWithin];
              return days ? days * 24 * 60 * 60 * 1000 : 0;
            })();
            const anchor = dateValue ? new Date(dateValue) : null;
            const anchorOk = anchor && !Number.isNaN(anchor.getTime());
            const needle = userQ.trim().toLowerCase();

            let filtered = (cached || []).filter((row) => {
              const labels = row.label_ids || [];
              if (labels.includes('APP_TRASH')) return false;
              const participants = (row.participants || [])
                .join(' ')
                .toLowerCase();
              const subject = String(row.subject || '').toLowerCase();
              const snippet = String(row.snippet || '').toLowerCase();
              const hay = `${subject} ${snippet} ${participants}`;
              if (needle && !hay.includes(needle)) return false;
              if (hasWords && !hay.includes(hasWords)) return false;
              if (subjectQ && !subject.includes(subjectQ)) return false;
              if (fromQ && !participants.includes(fromQ)) return false;
              if (toQ && !participants.includes(toQ)) return false;
              if (withinMs && anchorOk && row.last_message_at) {
                const ts = new Date(row.last_message_at).getTime();
                if (Number.isNaN(ts)) return false;
                if (Math.abs(ts - anchor.getTime()) > withinMs) return false;
              }
              return true;
            });

            if (sort === 'from_asc') {
              filtered = filtered.sort((a, b) =>
                String(a.participants?.[0] || '').localeCompare(
                  String(b.participants?.[0] || ''),
                  undefined,
                  { sensitivity: 'base' },
                ),
              );
            }

            const total = filtered.length;
            const pageRows = filtered.slice(
              page * pageSize,
              page * pageSize + pageSize,
            );
            const summaries = pageRows.map((row) => ({
              id: row.gmail_thread_id,
              dbId: row.id,
              accountId: row.gmail_account_id,
              snippet: row.snippet || '',
              subject: row.subject || '(no subject)',
              from: row.participants?.[0] || '',
              to: '',
              date: row.last_message_at,
              isUnread: Boolean(row.is_unread),
              isStarred: Boolean(row.is_starred),
              messageCount: 0,
              labelIds: row.label_ids || [],
              interviewId: row.interview_id || null,
              interview: row.interview || null,
              matchedTeamMemberId: row.matched_team_member_id || null,
              matchedMember: row.matched_member || null,
              gmailAddress: row.account?.gmail_address || '',
            }));

            sendJson(res, 200, {
              data: {
                threads: summaries,
                page,
                pageSize,
                total,
                hasMore: (page + 1) * pageSize < total,
                nextPageToken:
                  (page + 1) * pageSize < total ? String(page + 1) : '',
                resultSizeEstimate: total,
              },
            });
            return;
          }

          const accountMatch = path.match(
            /^\/api\/gmail\/accounts\/([^/]+)(.*)$/,
          );
          if (accountMatch) {
            const accountId = accountMatch[1];
            const rest = accountMatch[2] || '';
            const rows = await sb(
              env,
              `gmail_accounts?id=eq.${accountId}&select=*`,
            );
            const account = Array.isArray(rows) ? rows[0] : null;
            if (!account) {
              sendJson(res, 404, { error: 'Gmail account not found.' });
              return;
            }

            if (rest === '' && req.method === 'DELETE') {
              assertMailAdmin(profile);
              await sb(env, `gmail_accounts?id=eq.${accountId}`, {
                method: 'DELETE',
              });
              sendJson(res, 200, { data: { ok: true } });
              return;
            }

            if (rest === '/sync' && req.method === 'POST') {
              assertMailAdmin(profile);
              if (body.resetCursor) fullSyncCursors.delete(accountId);
              const result = await syncAccount(env, account, {
                full: Boolean(body.full),
                maxThreads: body.full ? 30 : 20,
                pageToken: body.pageToken || '',
                force: Boolean(body.force),
              });
              sendJson(res, result.success ? 200 : 207, { data: result });
              return;
            }

            const threadMatch = rest.match(/^\/threads\/([^/]+)$/);
            if (threadMatch && req.method === 'GET') {
              const token = await getAccountAccessToken(env, accountId);
              const full = await getThread(token, threadMatch[1], 'full', {
                accountId,
              });
              const messages = (full?.messages || []).map(parseGmailMessage);
              await upsertSyncedThread(env, account, messages);
              const cached = await sb(
                env,
                `mail_threads?gmail_account_id=eq.${accountId}&gmail_thread_id=eq.${threadMatch[1]}&select=id,interview_id,matched_team_member_id,matched_member:teammembers!mail_threads_matched_team_member_id_fkey(id,name,email),interview:interviews!mail_threads_interview_id_fkey(id,interview_name,start_time,meeting_link,stage)`,
              );
              sendJson(res, 200, {
                data: {
                  id: full.id,
                  accountId,
                  messages,
                  interview: Array.isArray(cached) ? cached[0]?.interview : null,
                  interviewId: Array.isArray(cached)
                    ? cached[0]?.interview_id
                    : null,
                  dbThreadId: Array.isArray(cached) ? cached[0]?.id : null,
                  matchedTeamMemberId: Array.isArray(cached)
                    ? cached[0]?.matched_team_member_id
                    : null,
                  matchedMember: Array.isArray(cached)
                    ? cached[0]?.matched_member
                    : null,
                },
              });
              return;
            }

            if (rest === '/mark-seen' && req.method === 'POST') {
              assertMailAdmin(profile);
              const { gmailThreadId, unread } = body;
              if (!gmailThreadId) {
                sendJson(res, 400, { error: 'gmailThreadId is required.' });
                return;
              }
              await sb(
                env,
                `mail_threads?gmail_account_id=eq.${accountId}&gmail_thread_id=eq.${gmailThreadId}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ is_unread: unread === true }),
                },
              );
              sendJson(res, 200, {
                data: { ok: true, isUnread: unread === true },
              });
              return;
            }

            if (rest === '/star' && req.method === 'POST') {
              assertMailAdmin(profile);
              const { gmailThreadId, starred } = body;
              if (!gmailThreadId) {
                sendJson(res, 400, { error: 'gmailThreadId is required.' });
                return;
              }
              await sb(
                env,
                `mail_threads?gmail_account_id=eq.${accountId}&gmail_thread_id=eq.${gmailThreadId}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ is_starred: starred === true }),
                },
              );
              sendJson(res, 200, {
                data: { ok: true, isStarred: starred === true },
              });
              return;
            }

            if (rest === '/trash' && req.method === 'POST') {
              assertMailAdmin(profile);
              const ids = Array.isArray(body.gmailThreadIds)
                ? body.gmailThreadIds
                : body.gmailThreadId
                  ? [body.gmailThreadId]
                  : [];
              if (!ids.length) {
                sendJson(res, 400, {
                  error: 'gmailThreadId or gmailThreadIds is required.',
                });
                return;
              }
              for (const gmailThreadId of ids) {
                const threadRows = await sb(
                  env,
                  `mail_threads?gmail_account_id=eq.${accountId}&gmail_thread_id=eq.${gmailThreadId}&select=id,label_ids`,
                );
                const row = Array.isArray(threadRows) ? threadRows[0] : null;
                if (!row) continue;
                const nextLabels = [
                  ...new Set([
                    ...(row.label_ids || []).filter((id) => id !== 'INBOX'),
                    'APP_TRASH',
                  ]),
                ];
                await sb(env, `mail_threads?id=eq.${row.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ label_ids: nextLabels }),
                });
              }
              sendJson(res, 200, { data: { ok: true, count: ids.length } });
              return;
            }

            if (rest === '/link-interview' && req.method === 'POST') {
              assertMailAdmin(profile);
              const { gmailThreadId, interviewId } = body;
              if (!gmailThreadId) {
                sendJson(res, 400, { error: 'gmailThreadId is required.' });
                return;
              }
              const threadRows = await sb(
                env,
                `mail_threads?gmail_account_id=eq.${accountId}&gmail_thread_id=eq.${gmailThreadId}&select=id`,
              );
              const existing = Array.isArray(threadRows) ? threadRows[0] : null;
              if (existing) {
                await sb(env, `mail_threads?id=eq.${existing.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ interview_id: interviewId || null }),
                });
              } else {
                await sb(env, 'mail_threads', {
                  method: 'POST',
                  body: JSON.stringify({
                    gmail_account_id: accountId,
                    gmail_thread_id: gmailThreadId,
                    interview_id: interviewId || null,
                    matched_team_member_id: account.team_member_id || null,
                  }),
                });
              }
              sendJson(res, 200, { data: { ok: true } });
              return;
            }

            if (rest === '/attachment' && req.method === 'GET') {
              const query = new URL(rawUrl, 'http://localhost').searchParams;
              const messageId = query.get('messageId');
              const attachmentId = query.get('attachmentId');
              const filename = query.get('filename') || 'attachment';
              const mimeType =
                query.get('mimeType') || 'application/octet-stream';
              if (!messageId || !attachmentId) {
                sendJson(res, 400, {
                  error: 'messageId and attachmentId required.',
                });
                return;
              }
              const token = await getAccountAccessToken(env, accountId);
              const payload = await getAttachment(
                token,
                messageId,
                attachmentId,
                { accountId },
              );
              const binary = Buffer.from(
                String(payload.data || '')
                  .replace(/-/g, '+')
                  .replace(/_/g, '/'),
                'base64',
              );
              res.statusCode = 200;
              res.setHeader('Content-Type', mimeType);
              res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename.replace(/"/g, '')}"`,
              );
              res.setHeader('Content-Length', String(binary.length));
              res.end(binary);
              return;
            }
          }

          sendJson(res, 404, { error: 'Unknown Gmail API route.' });
        } catch (err) {
          sendJson(res, err.status || 500, {
            error: err.message || 'Gmail request failed.',
          });
        }
      });
    },
  };
}
