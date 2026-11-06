import {
  getGoogleOAuthEndpoints,
  withGoogleEnvFile,
} from './googleOAuthConfig.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const DEFAULT_FOLDER_NAME = 'Interview Recordings';

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

let cachedToken = { accessToken: '', expiresAt: 0 };
let cachedFolderId = '';

export function getAllowedMimeTypes() {
  return [...ALLOWED_MIME_TYPES];
}

export function isAllowedVideoMime(mimeType = '') {
  return ALLOWED_MIME_TYPES.has(String(mimeType).toLowerCase());
}

export function extractDriveFileId(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw) && !raw.includes('/')) {
    return raw;
  }

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

export function buildDriveFileUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function buildDrivePreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

function requireDriveEnv(env) {
  const e = withGoogleEnvFile(env);
  const clientId = e.GOOGLE_CLIENT_ID;
  const clientSecret = e.GOOGLE_CLIENT_SECRET;
  const refreshToken = e.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw Object.assign(
      new Error(
        'Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in frontend/.env.',
      ),
      { status: 500 },
    );
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    folderName: e.GOOGLE_DRIVE_FOLDER_NAME || DEFAULT_FOLDER_NAME,
    folderId: e.GOOGLE_DRIVE_FOLDER_ID || '',
  };
}

export async function getAccessToken(env) {
  const cfg = requireDriveEnv(env);
  const now = Date.now();
  if (cachedToken.accessToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token',
  });

  const { tokenUri } = getGoogleOAuthEndpoints(env);
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw Object.assign(
      new Error(
        payload.error_description ||
          payload.error ||
          'Failed to refresh Google OAuth access token.',
      ),
      { status: 502 },
    );
  }

  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

async function driveFetch(env, path, options = {}) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  return response;
}

async function findFolderIdByName(env, folderName) {
  const q = [
    `name='${folderName.replace(/'/g, "\\'")}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    'trashed=false',
  ].join(' and ');

  const response = await driveFetch(
    env,
    `/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)&pageSize=5`,
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to search Drive folders.'),
      { status: 502 },
    );
  }
  return payload.files?.[0]?.id || '';
}

async function createFolder(env, folderName) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(`${DRIVE_API}/files?fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) {
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to create Drive folder.'),
      { status: 502 },
    );
  }
  return payload.id;
}

export async function ensureInterviewRecordingsFolder(env) {
  const cfg = requireDriveEnv(env);
  if (cfg.folderId) return cfg.folderId;
  if (cachedFolderId) return cachedFolderId;

  let folderId = await findFolderIdByName(env, cfg.folderName);
  if (!folderId) {
    folderId = await createFolder(env, cfg.folderName);
  }
  cachedFolderId = folderId;
  return folderId;
}

export async function createResumableUploadSession(env, {
  filename,
  mimeType,
  interviewId,
}) {
  if (!isAllowedVideoMime(mimeType)) {
    throw Object.assign(
      new Error('Only MP4, WebM, and MOV videos are supported.'),
      { status: 400 },
    );
  }

  const folderId = await ensureInterviewRecordingsFolder(env);
  const accessToken = await getAccessToken(env);
  const safeName = String(filename || 'recording.mp4')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
  const name = `interview-${interviewId}-${Date.now()}-${safeName}`;

  const response = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink,mimeType,size`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify({
        name,
        parents: [folderId],
        description: `Interview recording for ${interviewId}`,
        // Bind file to interview so /api/drive/complete cannot attach arbitrary Drive files.
        appProperties: {
          calidInterviewId: String(interviewId),
        },
      }),
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(
        payload.error?.message || 'Failed to start Google Drive upload session.',
      ),
      { status: 502 },
    );
  }

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) {
    throw Object.assign(
      new Error('Google Drive did not return an upload URL.'),
      { status: 502 },
    );
  }

  return { uploadUrl, name, folderId };
}

export async function makeFileLinkReadable(env, fileId) {
  const accessToken = await getAccessToken(env);
  const response = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone',
      allowFileDiscovery: false,
    }),
  });

  // 409 = permission already exists
  if (!response.ok && response.status !== 409) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to set Drive sharing.'),
      { status: 502 },
    );
  }
}

export async function getFileMetadata(env, fileId) {
  const response = await driveFetch(
    env,
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,webContentLink,parents,description,appProperties`,
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to load Drive file.'),
      { status: response.status === 404 ? 404 : 502 },
    );
  }
  return payload;
}

/** Ensure a Drive file was created by Cal.ID for this interview (not an arbitrary fileId). */
export async function assertFileBelongsToInterview(env, fileId, interviewId) {
  const meta = await getFileMetadata(env, fileId);
  const expectedId = String(interviewId || '');
  const boundId = String(meta.appProperties?.calidInterviewId || '');
  const namePrefix = `interview-${expectedId}-`;
  const nameOk = String(meta.name || '').startsWith(namePrefix);
  const descOk = String(meta.description || '').includes(expectedId);
  const propertyOk = boundId && boundId === expectedId;

  if (!propertyOk && !(nameOk && descOk)) {
    throw Object.assign(
      new Error('Drive file is not bound to this interview.'),
      { status: 403 },
    );
  }

  if (!isAllowedVideoMime(meta.mimeType || '')) {
    throw Object.assign(
      new Error('Drive file is not an allowed interview video type.'),
      { status: 400 },
    );
  }

  const folderId = await ensureInterviewRecordingsFolder(env);
  const parents = Array.isArray(meta.parents) ? meta.parents : [];
  if (folderId && parents.length > 0 && !parents.includes(folderId)) {
    throw Object.assign(
      new Error('Drive file is not in the Interview Recordings folder.'),
      { status: 403 },
    );
  }

  return meta;
}

export async function deleteDriveFile(env, fileId) {
  if (!fileId) return;
  const response = await driveFetch(env, `/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to delete Drive file.'),
      { status: 502 },
    );
  }
}

export async function openDriveMediaStream(env, fileId, rangeHeader = '') {
  const accessToken = await getAccessToken(env);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (rangeHeader) headers.Range = rangeHeader;

  const response = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers },
  );

  if (!response.ok && response.status !== 206) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(payload.error?.message || 'Failed to stream Drive video.'),
      { status: response.status === 404 ? 404 : 502 },
    );
  }

  return response;
}
