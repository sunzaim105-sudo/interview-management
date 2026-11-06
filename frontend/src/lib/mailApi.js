import { supabase } from './supabase';

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  return token;
}

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify({ ...body, accessToken }) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  if (
    path.includes('/attachment') &&
    response.ok &&
    !contentType.includes('application/json')
  ) {
    return response.blob();
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Mail request failed.');
  }
  return payload.data;
}

export async function fetchMailBootstrap() {
  return api('/api/gmail/accounts');
}

export async function fetchGmailConnections() {
  return api('/api/gmail/connections');
}

/** Start OAuth for a specific team member's Gmail (consent on their account). */
export async function startGmailConnect(
  teamMemberId,
  { returnTo = '/dashboard/settings' } = {},
) {
  // Prefer Authorization header — keep JWT out of the query string (avoids
  // oversized / malformed intermediate URLs during Connect).
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    json: '1',
    teamMemberId,
    returnTo,
  });
  const response = await fetch(`/api/gmail/oauth/start?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to start Gmail authorization.');
  }
  const authUrl = payload.data?.authUrl;
  if (!authUrl || !String(authUrl).startsWith('https://accounts.google.com/')) {
    throw new Error('Server returned an invalid Google authorization URL.');
  }
  return authUrl;
}

export async function disconnectGmailConnection(teamMemberId) {
  return api(`/api/gmail/connections/${teamMemberId}`, { method: 'DELETE' });
}

export async function disconnectGmailAccount(accountId) {
  return api(`/api/gmail/accounts/${accountId}`, { method: 'DELETE' });
}

export async function syncGmailAccount(accountId, { full = false } = {}) {
  return api(`/api/gmail/accounts/${accountId}/sync`, {
    method: 'POST',
    body: { full },
  });
}

export async function syncAllGmailAccounts({ full = false } = {}) {
  return api('/api/gmail/sync-all', {
    method: 'POST',
    body: { full },
  });
}

export async function fetchMailThreads({
  folder = 'inbox',
  q = '',
  page = 0,
  pageSize = 40,
  unreadOnly = false,
  teamMemberId = '',
  sort = 'date_desc',
  from = '',
  to = '',
  subject = '',
  hasWords = '',
  dateWithin = '',
  date = '',
} = {}) {
  const params = new URLSearchParams({
    folder,
    q,
    page: String(page),
    pageSize: String(pageSize),
    unread: unreadOnly ? '1' : '0',
    sort,
  });
  if (teamMemberId) params.set('teamMemberId', teamMemberId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (subject) params.set('subject', subject);
  if (hasWords) params.set('hasWords', hasWords);
  if (dateWithin) params.set('dateWithin', dateWithin);
  if (date) params.set('date', date);
  return api(`/api/gmail/threads?${params.toString()}`);
}

export async function fetchMailThread(accountId, threadId) {
  return api(
    `/api/gmail/accounts/${accountId}/threads/${encodeURIComponent(threadId)}`,
  );
}

export async function markMailThreadSeen(accountId, gmailThreadId, unread = false) {
  return api(`/api/gmail/accounts/${accountId}/mark-seen`, {
    method: 'POST',
    body: { gmailThreadId, unread },
  });
}

export async function starMailThread(accountId, gmailThreadId, starred) {
  return api(`/api/gmail/accounts/${accountId}/star`, {
    method: 'POST',
    body: { gmailThreadId, starred },
  });
}

export async function trashMailThreads(accountId, gmailThreadIds) {
  return api(`/api/gmail/accounts/${accountId}/trash`, {
    method: 'POST',
    body: { gmailThreadIds },
  });
}

/** Trash across accounts: [{ accountId, gmailThreadId }, ...] */
export async function trashMailThreadRefs(refs = []) {
  const byAccount = new Map();
  for (const ref of refs) {
    if (!ref?.accountId || !ref?.gmailThreadId) continue;
    const list = byAccount.get(ref.accountId) || [];
    list.push(ref.gmailThreadId);
    byAccount.set(ref.accountId, list);
  }
  for (const [accountId, ids] of byAccount.entries()) {
    await trashMailThreads(accountId, ids);
  }
  return { ok: true };
}

export async function linkThreadInterview(accountId, gmailThreadId, interviewId) {
  return api(`/api/gmail/accounts/${accountId}/link-interview`, {
    method: 'POST',
    body: { gmailThreadId, interviewId },
  });
}

export async function downloadMailAttachment(
  accountId,
  { messageId, attachmentId, filename, mimeType },
) {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    messageId,
    attachmentId,
    filename: filename || 'attachment',
    mimeType: mimeType || 'application/octet-stream',
  });
  const response = await fetch(
    `/api/gmail/accounts/${accountId}/attachment?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to download attachment.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'attachment';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function fetchInterviewsForLinking() {
  const { data, error } = await supabase
    .from('interviews')
    .select(
      'id, interview_name, start_time, invited_member_id, caller:users!interviews_caller_id_fkey(username, email), invited_member:teammembers!interviews_invited_member_id_fkey(name, email)',
    )
    .order('start_time', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}
