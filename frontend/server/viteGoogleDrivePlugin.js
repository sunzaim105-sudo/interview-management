import crypto from 'node:crypto';
import { loadEnv } from 'vite';
import {
  assertFileBelongsToInterview,
  buildDriveFileUrl,
  buildDrivePreviewUrl,
  createResumableUploadSession,
  deleteDriveFile,
  extractDriveFileId,
  getAccessToken,
  getFileMetadata,
  isAllowedVideoMime,
  openDriveMediaStream,
} from './googleDrive.js';
import {
  GMAIL_OAUTH_REDIRECT_URI,
  getGoogleClientCredentials,
  getGoogleOAuthEndpoints,
  withGoogleEnvFile,
} from './googleOAuthConfig.js';
import { signOAuthState } from './tokenCrypto.js';

const watchTickets = new Map();
const TICKET_TTL_MS = 15 * 60 * 1000;
// Reuse the registered Vite redirect URI (InterviewManagement client).
const DRIVE_VITE_REDIRECT_URI = GMAIL_OAUTH_REDIRECT_URI;
const DRIVE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
].join(' ');

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

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

function getEnv(mode) {
  return withGoogleEnvFile(loadEnv(mode, process.cwd(), ''));
}

function getBearerToken(req, body = {}) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return body.accessToken || '';
}

function pruneTickets() {
  const now = Date.now();
  for (const [key, value] of watchTickets.entries()) {
    if (!value || value.expiresAt <= now) watchTickets.delete(key);
  }
}

function createWatchTicket(fileId, userId) {
  pruneTickets();
  const ticket = cryptoRandomTicket(userId);
  watchTickets.set(ticket, {
    fileId,
    userId,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

function cryptoRandomTicket(userId) {
  return `${userId}-${crypto.randomBytes(16).toString('hex')}`;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function setWatchTicketCookie(res, ticket) {
  const maxAge = Math.floor(TICKET_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    [
      `drive_watch=${encodeURIComponent(ticket)}`,
      'Path=/api/drive/stream',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAge}`,
    ].join('; '),
  );
}

function supabaseKeys(env) {
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const service = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || (!anon && !service)) {
    throw Object.assign(new Error('Supabase env is not configured.'), {
      status: 500,
    });
  }
  return { url, anon, service };
}

async function fetchAuthUser(env, accessToken) {
  const { url, anon, service } = supabaseKeys(env);
  // Prefer service-role apikey for server-side JWT checks — more reliable with
  // newer sb_publishable_* keys than anon-only GoTrue validation.
  const keyOrder = [service, anon].filter(Boolean);
  let lastPayload = {};
  for (const apikey of keyOrder) {
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const authUser = await userRes.json().catch(() => ({}));
    if (userRes.ok && authUser?.id) return authUser;
    lastPayload = authUser;
  }
  const detail =
    lastPayload?.msg ||
    lastPayload?.error_description ||
    lastPayload?.error ||
    '';
  throw Object.assign(
    new Error(
      detail
        ? `Invalid session (${detail}). Sign out and sign in again.`
        : 'Invalid session. Sign out and sign in again.',
    ),
    { status: 401 },
  );
}

async function assertInterviewVideoAccess(env, accessToken, interviewId) {
  if (!accessToken) {
    throw Object.assign(new Error('Missing access token.'), { status: 401 });
  }

  const { url, anon, service } = supabaseKeys(env);
  const authUser = await fetchAuthUser(env, accessToken);
  const restKey = service || anon;
  const restHeaders = {
    apikey: restKey,
    Authorization: service
      ? `Bearer ${service}`
      : `Bearer ${accessToken}`,
  };

  const profileRes = await fetch(
    `${url}/rest/v1/users?id=eq.${authUser.id}&select=id,user_role,status`,
    { headers: restHeaders },
  );
  const profiles = await profileRes.json().catch(() => []);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || profile.status !== 'allowed') {
    throw Object.assign(new Error('Account is not allowed.'), { status: 403 });
  }

  if (!interviewId) {
    return {
      profile,
      interview: null,
      isAdmin: profile.user_role === 'admin',
      isTeamMember: profile.user_role === 'team_member',
      isOwnerCaller: false,
    };
  }

  const interviewRes = await fetch(
    `${url}/rest/v1/interviews?id=eq.${interviewId}&select=id,caller_id,video_path,end_time`,
    { headers: restHeaders },
  );
  const interviews = await interviewRes.json().catch(() => []);
  const interview = Array.isArray(interviews) ? interviews[0] : null;
  if (!interview) {
    throw Object.assign(new Error('Interview not found.'), { status: 404 });
  }

  const isAdmin = profile.user_role === 'admin';
  const isTeamMember = profile.user_role === 'team_member';
  const isOwnerCaller =
    profile.user_role === 'caller' && interview.caller_id === profile.id;

  return { profile, interview, isAdmin, isTeamMember, isOwnerCaller };
}

function interviewHasConcluded(interview) {
  const end = new Date(interview?.end_time || 0).getTime();
  return Number.isFinite(end) && end > 0 && Date.now() >= end;
}

/** Callers upload/replace their own interviews; admins cannot upload. */
async function assertCallerCanUpload(env, accessToken, interviewId) {
  const access = await assertInterviewVideoAccess(env, accessToken, interviewId);
  if (!access.isOwnerCaller) {
    throw Object.assign(
      new Error('Only the assigned caller can upload or replace this video.'),
      { status: 403 },
    );
  }
  if (!interviewHasConcluded(access.interview)) {
    throw Object.assign(
      new Error(
        'Interview results can only be added after the interview session has concluded.',
      ),
      { status: 403 },
    );
  }
  return access;
}

/** Admin, team member, or assigned caller may watch. */
async function assertCanWatchVideo(env, accessToken, interviewId) {
  const access = await assertInterviewVideoAccess(env, accessToken, interviewId);
  if (!access.isAdmin && !access.isTeamMember && !access.isOwnerCaller) {
    throw Object.assign(new Error('Not allowed to watch this interview video.'), {
      status: 403,
    });
  }
  return access;
}

/** Admin and team member may download. */
async function assertCanDownloadVideo(env, accessToken, interviewId) {
  const access = await assertInterviewVideoAccess(env, accessToken, interviewId);
  if (!access.isAdmin && !access.isTeamMember) {
    throw Object.assign(
      new Error('Only admins and team members can download interview videos.'),
      { status: 403 },
    );
  }
  return access;
}

/** Admins only — remove Drive file / admin-only mutations. */
async function assertAdminVideoAction(env, accessToken, interviewId) {
  const access = await assertInterviewVideoAccess(env, accessToken, interviewId);
  if (!access.isAdmin) {
    throw Object.assign(new Error('Only admins can perform this video action.'), {
      status: 403,
    });
  }
  return access;
}

async function assertAuthenticated(env, accessToken) {
  return assertInterviewVideoAccess(env, accessToken, '');
}

export function googleDrivePlugin() {
  return {
    name: 'google-drive-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Re-read .env each request so Connect Drive updates are visible immediately.
        const env = getEnv(server.config.mode);
        const path = req.url?.split('?')[0];
        if (!path?.startsWith('/api/drive/')) {
          next();
          return;
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        try {
          if (path === '/api/drive/status' && req.method === 'GET') {
            const accessToken = getBearerToken(req);
            await assertAuthenticated(env, accessToken);
            const configured = Boolean(
              env.GOOGLE_CLIENT_ID &&
                env.GOOGLE_CLIENT_SECRET &&
                env.GOOGLE_REFRESH_TOKEN,
            );
            sendJson(res, 200, {
              data: {
                configured,
                folderName:
                  env.GOOGLE_DRIVE_FOLDER_NAME || 'Interview Recordings',
                redirectUri: DRIVE_VITE_REDIRECT_URI,
                authorizeUrl: '/api/drive/oauth/start',
              },
            });
            return;
          }

          if (path === '/api/drive/oauth/start' && req.method === 'GET') {
            const query = new URL(req.url, 'http://localhost').searchParams;
            // Prefer Authorization header; query token kept for older clients.
            const accessToken = getBearerToken(req) || query.get('accessToken');
            const { profile } = await assertAdminVideoAction(
              env,
              accessToken,
              '',
            );

            const { clientId } = getGoogleClientCredentials(env);
            const { authUri } = getGoogleOAuthEndpoints(env);
            const tokenSecret =
              env.GMAIL_TOKEN_SECRET || env.SUPABASE_SECRET_KEY || '';
            const state = signOAuthState(
              {
                ts: Date.now(),
                kind: 'drive',
                userId: profile.id,
              },
              tokenSecret,
            );
            const authUrl = new URL(authUri);
            authUrl.searchParams.set('client_id', clientId);
            authUrl.searchParams.set('redirect_uri', DRIVE_VITE_REDIRECT_URI);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('scope', DRIVE_OAUTH_SCOPES);
            authUrl.searchParams.set('access_type', 'offline');
            authUrl.searchParams.set('prompt', 'consent');
            authUrl.searchParams.set('state', state);
            if (query.get('json') === '1') {
              sendJson(res, 200, { data: { authUrl: authUrl.toString() } });
              return;
            }
            redirect(res, authUrl.toString());
            return;
          }

          if (path === '/api/drive/upload-session' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const accessToken = getBearerToken(req, body);
            const { interviewId, filename, mimeType, size } = body;

            if (!interviewId || !filename || !mimeType) {
              sendJson(res, 400, {
                error: 'interviewId, filename, and mimeType are required.',
              });
              return;
            }
            if (!isAllowedVideoMime(mimeType)) {
              sendJson(res, 400, {
                error: 'Only MP4, WebM, and MOV videos are supported.',
              });
              return;
            }
            if (size != null && Number(size) <= 0) {
              sendJson(res, 400, { error: 'Invalid file size.' });
              return;
            }

            await assertCallerCanUpload(env, accessToken, interviewId);
            const session = await createResumableUploadSession(env, {
              interviewId,
              filename,
              mimeType,
            });
            sendJson(res, 200, { data: session });
            return;
          }

          // Proxied resumable upload (avoids browser→Drive CORS). Supports retries
          // by re-posting the full file; progress is tracked on the client XHR.
          if (path === '/api/drive/upload' && req.method === 'POST') {
            const query = new URL(req.url, 'http://localhost').searchParams;
            const accessToken = getBearerToken(req);
            const interviewId = query.get('interviewId') || '';
            const filename = query.get('filename') || 'recording.mp4';
            const mimeType =
              query.get('mimeType') ||
              req.headers['content-type'] ||
              'video/mp4';
            const previousVideoPath = query.get('previousVideoPath') || '';
            const size = Number(req.headers['content-length'] || 0);

            if (!interviewId) {
              sendJson(res, 400, { error: 'interviewId is required.' });
              return;
            }
            if (!isAllowedVideoMime(mimeType)) {
              sendJson(res, 400, {
                error: 'Only MP4, WebM, and MOV videos are supported.',
              });
              return;
            }

            await assertCallerCanUpload(env, accessToken, interviewId);
            const session = await createResumableUploadSession(env, {
              interviewId,
              filename,
              mimeType,
            });

            const googleToken = await getAccessToken(env);
            const uploadHeaders = {
              Authorization: `Bearer ${googleToken}`,
              'Content-Type': mimeType,
            };
            if (size > 0) {
              uploadHeaders['Content-Length'] = String(size);
              uploadHeaders['Content-Range'] = `bytes 0-${size - 1}/${size}`;
            }

            // Stream the request body to Google (Node fetch requires duplex).
            const uploadRes = await fetch(session.uploadUrl, {
              method: 'PUT',
              headers: uploadHeaders,
              body: req,
              duplex: 'half',
            });
            const uploaded = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok || !uploaded.id) {
              sendJson(res, 502, {
                error:
                  uploaded.error?.message ||
                  'Failed to upload video to Google Drive.',
              });
              return;
            }

            // Keep Drive files private; Watch/Download use authenticated proxies.
            const meta = await getFileMetadata(env, uploaded.id);
            const fileUrl = meta.webViewLink || buildDriveFileUrl(uploaded.id);

            const previousId = extractDriveFileId(previousVideoPath);
            if (previousId && previousId !== uploaded.id) {
              try {
                await deleteDriveFile(env, previousId);
              } catch {
                // best-effort
              }
            }

            sendJson(res, 200, {
              data: {
                fileId: uploaded.id,
                fileUrl,
                previewUrl: buildDrivePreviewUrl(uploaded.id),
                name: meta.name || session.name,
                mimeType: meta.mimeType || mimeType,
                size: meta.size || size || null,
              },
            });
            return;
          }

          if (path === '/api/drive/complete' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const accessToken = getBearerToken(req, body);
            const { interviewId, fileId, previousVideoPath = '' } = body;
            if (!interviewId || !fileId) {
              sendJson(res, 400, {
                error: 'interviewId and fileId are required.',
              });
              return;
            }

            await assertCallerCanUpload(env, accessToken, interviewId);
            // Reject arbitrary Drive fileIds — must be Cal.ID-bound to this interview.
            const meta = await assertFileBelongsToInterview(
              env,
              fileId,
              interviewId,
            );
            const fileUrl = meta.webViewLink || buildDriveFileUrl(fileId);

            const previousId = extractDriveFileId(previousVideoPath);
            if (previousId && previousId !== fileId) {
              try {
                await deleteDriveFile(env, previousId);
              } catch {
                // Best-effort cleanup of the previous recording.
              }
            }

            sendJson(res, 200, {
              data: {
                fileId,
                fileUrl,
                previewUrl: buildDrivePreviewUrl(fileId),
                name: meta.name || '',
                mimeType: meta.mimeType || '',
                size: meta.size || null,
              },
            });
            return;
          }

          if (path === '/api/drive/watch' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const accessToken = getBearerToken(req, body);
            const interviewId = String(body.interviewId || '').trim();
            if (!interviewId) {
              sendJson(res, 400, { error: 'interviewId is required.' });
              return;
            }

            const { profile, interview } = await assertCanWatchVideo(
              env,
              accessToken,
              interviewId,
            );
            const storedId = extractDriveFileId(interview?.video_path || '');
            const requestedId =
              extractDriveFileId(body.fileId || body.videoPath || '') || '';
            const fileId = storedId || requestedId;
            if (!fileId) {
              sendJson(res, 404, { error: 'No video is stored for this interview.' });
              return;
            }
            // Prevent streaming arbitrary Drive files via the app token.
            if (storedId && requestedId && storedId !== requestedId) {
              sendJson(res, 403, {
                error: 'Video file does not match this interview.',
              });
              return;
            }

            const ticket = createWatchTicket(fileId, profile.id);
            // Prefer HttpOnly cookie so the ticket is not exposed in URLs / Referer.
            setWatchTicketCookie(res, ticket);
            sendJson(res, 200, {
              data: {
                fileId,
                previewUrl: buildDrivePreviewUrl(fileId),
                streamUrl: '/api/drive/stream',
                fileUrl: buildDriveFileUrl(fileId),
              },
            });
            return;
          }

          if (path === '/api/drive/stream' && req.method === 'GET') {
            const cookies = parseCookies(req.headers.cookie || '');
            const ticket = cookies.drive_watch || '';
            pruneTickets();
            const entry = ticket ? watchTickets.get(ticket) : null;
            if (!entry) {
              sendJson(res, 401, { error: 'Watch ticket expired or invalid.' });
              return;
            }

            const driveRes = await openDriveMediaStream(
              env,
              entry.fileId,
              req.headers.range || '',
            );

            res.statusCode = driveRes.status;
            const passHeaders = [
              'content-type',
              'content-length',
              'content-range',
              'accept-ranges',
            ];
            for (const key of passHeaders) {
              const value = driveRes.headers.get(key);
              if (value) res.setHeader(key, value);
            }
            res.setHeader('Cache-Control', 'private, max-age=60');
            res.setHeader('Referrer-Policy', 'no-referrer');

            if (!driveRes.body) {
              const buffer = Buffer.from(await driveRes.arrayBuffer());
              res.end(buffer);
              return;
            }

            const reader = driveRes.body.getReader();
            const pump = async () => {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!res.write(Buffer.from(value))) {
                  await new Promise((resolve) => res.once('drain', resolve));
                }
              }
              res.end();
            };
            pump().catch(() => {
              try {
                res.end();
              } catch {
                // ignore
              }
            });
            return;
          }

          if (path === '/api/drive/download' && req.method === 'GET') {
            const query = new URL(req.url, 'http://localhost').searchParams;
            const accessToken = getBearerToken(req);
            const interviewId = query.get('interviewId') || '';
            const fileId = extractDriveFileId(
              query.get('fileId') || query.get('videoPath') || '',
            );
            if (!fileId) {
              sendJson(res, 400, { error: 'A Google Drive file id is required.' });
              return;
            }

            if (!interviewId) {
              sendJson(res, 400, { error: 'interviewId is required.' });
              return;
            }
            const { interview } = await assertCanDownloadVideo(
              env,
              accessToken,
              interviewId,
            );
            const storedId = extractDriveFileId(interview?.video_path || '');
            if (!storedId || storedId !== fileId) {
              sendJson(res, 403, {
                error: 'Video file does not match this interview.',
              });
              return;
            }

            const meta = await getFileMetadata(env, fileId);
            const driveRes = await openDriveMediaStream(env, fileId);
            const filename = (meta.name || 'interview-video.mp4').replace(
              /"/g,
              '',
            );

            res.statusCode = 200;
            res.setHeader(
              'Content-Type',
              meta.mimeType || 'application/octet-stream',
            );
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${filename}"`,
            );
            const length = driveRes.headers.get('content-length');
            if (length) res.setHeader('Content-Length', length);

            if (!driveRes.body) {
              res.end(Buffer.from(await driveRes.arrayBuffer()));
              return;
            }

            const reader = driveRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!res.write(Buffer.from(value))) {
                await new Promise((resolve) => res.once('drain', resolve));
              }
            }
            res.end();
            return;
          }

          if (path === '/api/drive/delete' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const accessToken = getBearerToken(req, body);
            const interviewId = body.interviewId || '';
            const fileId = extractDriveFileId(
              body.fileId || body.videoPath || '',
            );
            if (!interviewId || !fileId) {
              sendJson(res, 400, {
                error: 'interviewId and Drive file id are required.',
              });
              return;
            }

            const { interview } = await assertAdminVideoAction(
              env,
              accessToken,
              interviewId,
            );
            const storedId = extractDriveFileId(interview?.video_path || '');
            if (storedId && storedId !== fileId) {
              sendJson(res, 403, {
                error: 'Video file does not match this interview.',
              });
              return;
            }

            await deleteDriveFile(env, fileId);
            sendJson(res, 200, { data: { ok: true } });
            return;
          }

          sendJson(res, 404, { error: 'Unknown Drive API route.' });
        } catch (err) {
          sendJson(res, err.status || 500, {
            error: err.message || 'Google Drive request failed.',
          });
        }
      });
    },
  };
}
