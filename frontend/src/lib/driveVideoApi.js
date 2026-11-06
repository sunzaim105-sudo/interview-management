import { supabase } from './supabase';

const ALLOWED_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES = 4;

export function isDriveVideoPath(path = '') {
  const value = String(path || '');
  return (
    /drive\.google\.com/i.test(value) ||
    /^gdrive:/i.test(value) ||
    (/^[a-zA-Z0-9_-]{25,}$/.test(value) && !value.includes('/'))
  );
}

export function extractDriveFileId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw) && !raw.includes('/')) return raw;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /^gdrive:([a-zA-Z0-9_-]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

export function validateInterviewVideoFile(file) {
  if (!file) throw new Error('Choose a video file.');
  const mime = file.type || '';
  const name = (file.name || '').toLowerCase();
  const byExt =
    name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov');
  if (!ALLOWED_MIME.has(mime) && !byExt) {
    throw new Error('Only MP4, WebM, and MOV videos are supported.');
  }
  return {
    mimeType:
      mime ||
      (name.endsWith('.webm')
        ? 'video/webm'
        : name.endsWith('.mov')
          ? 'video/quicktime'
          : 'video/mp4'),
  };
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  let token = data.session?.access_token;
  const expiresAt = Number(data.session?.expires_at || 0) * 1000;
  // Refresh when missing or within 60s of expiry so Drive API auth stays valid.
  if (!token || (expiresAt && expiresAt < Date.now() + 60_000)) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) {
      throw new Error(
        refreshed.error.message ||
          'Invalid session. Sign out and sign in again.',
      );
    }
    token = refreshed.data.session?.access_token;
  }
  if (!token) throw new Error('You must be signed in.');
  return token;
}

export async function fetchDriveStatus() {
  return apiJson('/api/drive/status');
}

export async function startDriveConnect() {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({ accessToken, json: '1' });
  const data = await apiJson(`/api/drive/oauth/start?${params.toString()}`);
  return data.authUrl;
}

async function apiJson(path, { method = 'GET', body, headers = {} } = {}) {
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Google Drive request failed.');
  }
  return payload.data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function xhrPut(url, { data, headers, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      // 308 = Resume Incomplete for Google resumable uploads
      if (
        (xhr.status >= 200 && xhr.status < 300) ||
        xhr.status === 308
      ) {
        let json = null;
        try {
          json = JSON.parse(xhr.responseText || 'null');
        } catch {
          json = null;
        }
        resolve({
          status: xhr.status,
          json,
          raw: xhr.responseText,
          range: xhr.getResponseHeader('Range'),
        });
        return;
      }
      reject(
        new Error(
          `Upload chunk failed (${xhr.status}). ${xhr.responseText || ''}`.trim(),
        ),
      );
    };
    xhr.onerror = () => reject(new Error('Network error during Drive upload.'));
    xhr.send(data);
  });
}

async function putWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await xhrPut(url, options);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(700 * 2 ** attempt);
    }
  }
  throw lastError || new Error('Upload failed after retries.');
}

/**
 * Resumable chunked upload directly to Google Drive upload URL.
 * Progress callback receives percent 0-100.
 */
export async function uploadFileToDriveResumable(
  uploadUrl,
  file,
  mimeType,
  onProgress,
) {
  const total = file.size;
  let offset = 0;
  let completed = null;

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunk = file.slice(offset, end);
    const chunkStart = offset;

    const result = await putWithRetry(uploadUrl, {
      data: chunk,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(chunk.size),
        'Content-Range': `bytes ${chunkStart}-${end - 1}/${total}`,
      },
      onProgress: (loaded) => {
        const overall = chunkStart + loaded;
        onProgress?.(Math.min(99, Math.round((overall / total) * 100)));
      },
    });

    if (result.status === 200 || result.status === 201) {
      completed = result.json;
      offset = total;
      break;
    }

    // 308 Resume Incomplete — advance using Range response when present
    if (result.status === 308) {
      offset = end;
      continue;
    }

    offset = end;
  }

  onProgress?.(100);
  if (!completed?.id) {
    throw new Error('Drive upload finished without a file id.');
  }
  return completed;
}

/**
 * Upload via app server → Google Drive (preferred; avoids CORS).
 * Retries the full request on transient failures.
 */
export async function uploadFileViaDriveProxy({
  interviewId,
  file,
  mimeType,
  filename,
  previousVideoPath = '',
  onProgress,
}) {
  const accessToken = await getAccessToken();
  const params = new URLSearchParams({
    interviewId,
    filename: filename || file.name || 'recording.mp4',
    mimeType,
    previousVideoPath,
  });

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/drive/upload?${params.toString()}`);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable || !onProgress) return;
          onProgress(Math.min(97, Math.round((event.loaded / event.total) * 100)));
        };
        xhr.onload = () => {
          let payload = {};
          try {
            payload = JSON.parse(xhr.responseText || '{}');
          } catch {
            payload = {};
          }
          if (xhr.status >= 200 && xhr.status < 300 && payload.data?.fileUrl) {
            resolve(payload.data);
            return;
          }
          reject(
            new Error(
              payload.error || `Drive upload failed (${xhr.status}).`,
            ),
          );
        };
        xhr.onerror = () =>
          reject(new Error('Network error during Drive upload.'));
        xhr.send(file);
      });
      onProgress?.(99);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastError || new Error('Drive upload failed after retries.');
}

export async function startDriveUploadSession({
  interviewId,
  filename,
  mimeType,
  size,
}) {
  return apiJson('/api/drive/upload-session', {
    method: 'POST',
    body: { interviewId, filename, mimeType, size },
  });
}

export async function completeDriveUpload({
  interviewId,
  fileId,
  previousVideoPath = '',
}) {
  return apiJson('/api/drive/complete', {
    method: 'POST',
    body: { interviewId, fileId, previousVideoPath },
  });
}

export async function getDriveWatchPayload({ interviewId, videoPath }) {
  return apiJson('/api/drive/watch', {
    method: 'POST',
    body: { interviewId, videoPath },
  });
}

export async function deleteDriveVideo({ interviewId, videoPath }) {
  return apiJson('/api/drive/delete', {
    method: 'POST',
    body: { interviewId, videoPath },
  });
}

export async function downloadDriveVideo({
  interviewId,
  videoPath,
  filename = 'interview-video.mp4',
}) {
  const accessToken = await getAccessToken();
  const fileId = extractDriveFileId(videoPath);
  if (!fileId) throw new Error('No Google Drive video available.');

  const params = new URLSearchParams({
    fileId,
    interviewId: interviewId || '',
  });
  const response = await fetch(`/api/drive/download?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to download Drive video.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
