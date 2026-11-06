import { loadEnv } from 'vite';

const USER_ID_CHECK_WINDOW_MS = 15 * 60 * 1000;
const USER_ID_CHECK_MAX = 20;
const userIdCheckHits = new Map();

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

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function assertUserIdCheckRateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = userIdCheckHits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + USER_ID_CHECK_WINDOW_MS };
    userIdCheckHits.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > USER_ID_CHECK_MAX) {
    throw Object.assign(
      new Error('Too many User ID checks. Try again later.'),
      { status: 429 },
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnv(mode) {
  return loadEnv(mode, process.cwd(), '');
}

async function assertAllowedAdmin(env, accessToken) {
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
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const authUser = await userRes.json();
  if (!userRes.ok || !authUser?.id) {
    throw Object.assign(new Error('Invalid session.'), { status: 401 });
  }

  const profileRes = await fetch(
    `${url}/rest/v1/users?id=eq.${authUser.id}&select=id,user_role,status`,
    {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const profiles = await profileRes.json();
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (
    !profile ||
    profile.user_role !== 'admin' ||
    profile.status !== 'allowed'
  ) {
    throw Object.assign(new Error('Admin access required.'), { status: 403 });
  }

  return profile;
}

function serviceHeaders(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(
      new Error(
        'Set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in frontend/.env for user admin APIs.',
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
    },
  };
}

async function ensurePublicUserProfile(env, {
  id,
  email,
  username,
  userId,
  userRole = 'caller',
}) {
  const { url, headers } = serviceHeaders(env);

  const existingRes = await fetch(
    `${url}/rest/v1/users?id=eq.${id}&select=id,username,user_id,user_role,email,status`,
    { headers },
  );
  const existingRows = await existingRes.json().catch(() => []);
  if (existingRes.ok && Array.isArray(existingRows) && existingRows[0]) {
    return existingRows[0];
  }

  const authRes = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    headers,
  });
  const authUser = await authRes.json().catch(() => ({}));
  if (!authRes.ok || !authUser?.id) {
    throw Object.assign(
      new Error('Auth user was not found. Sign up again.'),
      { status: 404 },
    );
  }

  const authEmail = String(authUser.email || email || '')
    .trim()
    .toLowerCase();
  const meta = authUser.user_metadata || {};
  const safeUsername = String(
    username || meta.username || authEmail.split('@')[0] || id,
  ).trim();
  const safeUserId = String(userId || meta.user_id || '').trim();
  if (!safeUserId) {
    throw Object.assign(new Error('User ID is required.'), { status: 400 });
  }

  const takenRes = await fetch(
    `${url}/rest/v1/users?user_id=eq.${encodeURIComponent(safeUserId)}&select=id&limit=1`,
    { headers },
  );
  const takenRows = await takenRes.json().catch(() => []);
  if (takenRes.ok && Array.isArray(takenRows) && takenRows[0]?.id !== id) {
    throw Object.assign(
      new Error('That User ID is already taken. Choose a different unique User ID.'),
      { status: 409 },
    );
  }

  // Self-serve signup is always caller. Admins assign other roles later.
  void userRole;
  void meta.user_role;
  const role = 'caller';

  const payload = {
    id,
    username: safeUsername,
    user_id: safeUserId,
    user_role: role,
    email: authEmail || `${id}@users.local`,
    status: 'pending',
  };

  const upsertRes = await fetch(`${url}/rest/v1/users?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
  const upserted = await upsertRes.json().catch(() => ({}));
  if (!upsertRes.ok) {
    const message = String(upserted?.message || upserted?.error || '');
    if (/user_id|users_user_id|duplicate key/i.test(message)) {
      throw Object.assign(
        new Error(
          'That User ID is already taken. Choose a different unique User ID.',
        ),
        { status: 409 },
      );
    }
    throw Object.assign(
      new Error(message || 'Failed to create user profile.'),
      { status: upsertRes.status || 500 },
    );
  }

  // Confirm email so login works even when Supabase "Confirm email" is enabled.
  // App approval still gates access via public.users.status.
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ email_confirm: true }),
  });

  return Array.isArray(upserted) ? upserted[0] : upserted;
}

export function usersAdminPlugin() {
  return {
    name: 'users-admin-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        const isSignupProfile = path === '/api/auth/register-profile';
        const isUserIdCheck = path === '/api/auth/user-id-available';
        const isAdminUsers =
          path === '/api/users/create' || path === '/api/users/delete';

        if (!isSignupProfile && !isUserIdCheck && !isAdminUsers) {
          next();
          return;
        }

        // Re-read env each request (same pattern as Gmail/Drive plugins).
        const env = getEnv(server.config.mode);

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);

          if (isUserIdCheck) {
            // Public pre-signup check: rate-limit + constant delay to slow enumeration.
            assertUserIdCheckRateLimit(req);
            const started = Date.now();
            const loginId = String(body?.user_id || '').trim();
            if (!loginId) {
              sendJson(res, 400, { error: 'User ID is required.' });
              return;
            }
            if (!/^[A-Za-z0-9._-]{3,64}$/.test(loginId)) {
              sendJson(res, 400, {
                error:
                  'User ID must be 3–64 characters and use only letters, numbers, dots, underscores, or hyphens.',
              });
              return;
            }
            const { url, headers } = serviceHeaders(env);
            const takenRes = await fetch(
              `${url}/rest/v1/users?user_id=eq.${encodeURIComponent(loginId)}&select=id&limit=1`,
              { headers },
            );
            const takenRows = await takenRes.json().catch(() => []);
            const pad = 200 - (Date.now() - started);
            if (pad > 0) await sleep(pad);
            if (!takenRes.ok) {
              sendJson(res, takenRes.status, {
                error: 'Could not verify User ID availability.',
              });
              return;
            }
            sendJson(res, 200, {
              data: {
                available: !(Array.isArray(takenRows) && takenRows.length > 0),
              },
            });
            return;
          }

          if (isSignupProfile) {
            const id = String(body?.id || '').trim();
            if (!id) {
              sendJson(res, 400, { error: 'User id is required.' });
              return;
            }

            // Prefer session JWT matching the Auth user id.
            const accessToken =
              req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
              body?.accessToken ||
              '';
            if (accessToken) {
              const userRes = await fetch(
                `${env.VITE_SUPABASE_URL}/auth/v1/user`,
                {
                  headers: {
                    apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    Authorization: `Bearer ${accessToken}`,
                  },
                },
              );
              const authUser = await userRes.json().catch(() => ({}));
              if (!userRes.ok || authUser?.id !== id) {
                sendJson(res, 401, {
                  error: 'Invalid session for profile registration.',
                });
                return;
              }
            } else {
              // No session (email-confirm required): only allow freshly created
              // Auth users without an existing public.users row (10-minute window).
              const { url, headers } = serviceHeaders(env);
              const authRes = await fetch(`${url}/auth/v1/admin/users/${id}`, {
                headers,
              });
              const authUser = await authRes.json().catch(() => ({}));
              if (!authRes.ok || !authUser?.id) {
                sendJson(res, 401, {
                  error: 'Sign in or complete signup before registering a profile.',
                });
                return;
              }
              const createdAt = new Date(authUser.created_at || 0).getTime();
              if (
                !Number.isFinite(createdAt) ||
                Date.now() - createdAt > 10 * 60 * 1000
              ) {
                sendJson(res, 401, {
                  error:
                    'Signup session expired. Sign up again or ask an admin for help.',
                });
                return;
              }
            }

            const profile = await ensurePublicUserProfile(env, {
              id,
              email: body?.email,
              username: body?.username,
              userId: body?.user_id,
              userRole: 'caller',
            });
            sendJson(res, 200, { data: profile });
            return;
          }

          const accessToken =
            req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
            body?.accessToken;

          await assertAllowedAdmin(env, accessToken);
          const { url, headers } = serviceHeaders(env);

          if (path === '/api/users/create') {
            const email = String(body?.email || '').trim().toLowerCase();
            const password = String(body?.password || '');
            const username = String(body?.username || '').trim();
            const userId = String(body?.user_id || '').trim();
            const userRole = String(body?.user_role || 'caller').trim();
            const status = String(body?.status || 'allowed').trim();

            if (!email || !password || !username || !userId) {
              sendJson(res, 400, {
                error: 'Email, password, username, and user ID are required.',
              });
              return;
            }

            if (!['admin', 'caller', 'team_member'].includes(userRole)) {
              sendJson(res, 400, { error: 'Invalid role.' });
              return;
            }
            if (!['allowed', 'suspended', 'blocked', 'pending'].includes(status)) {
              sendJson(res, 400, { error: 'Invalid permission.' });
              return;
            }

            const createRes = await fetch(`${url}/auth/v1/admin/users`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                email,
                password,
                email_confirm: true,
                user_metadata: {
                  username,
                  user_id: userId,
                  user_role: userRole,
                },
              }),
            });
            const created = await createRes.json();
            if (!createRes.ok) {
              sendJson(res, createRes.status, {
                error:
                  created?.msg ||
                  created?.error_description ||
                  created?.message ||
                  'Failed to create auth user.',
              });
              return;
            }

            const authUserId = created?.id || created?.user?.id;
            const upsertRes = await fetch(`${url}/rest/v1/users?on_conflict=id`, {
              method: 'POST',
              headers: {
                ...headers,
                Prefer: 'resolution=merge-duplicates,return=representation',
              },
              body: JSON.stringify({
                id: authUserId,
                username,
                user_id: userId,
                user_role: userRole,
                email,
                status,
              }),
            });
            const upserted = await upsertRes.json();
            if (!upsertRes.ok) {
              sendJson(res, upsertRes.status, {
                error:
                  upserted?.message ||
                  upserted?.error ||
                  'Auth user created but profile upsert failed.',
              });
              return;
            }

            sendJson(res, 200, {
              data: Array.isArray(upserted) ? upserted[0] : upserted,
            });
            return;
          }

          const id = String(body?.id || '').trim();
          if (!id) {
            sendJson(res, 400, { error: 'User id is required.' });
            return;
          }

          const deleteAuth = await fetch(`${url}/auth/v1/admin/users/${id}`, {
            method: 'DELETE',
            headers,
          });
          if (!deleteAuth.ok && deleteAuth.status !== 404) {
            const errBody = await deleteAuth.json().catch(() => ({}));
            sendJson(res, deleteAuth.status, {
              error:
                errBody?.msg ||
                errBody?.message ||
                'Failed to delete auth user.',
            });
            return;
          }

          await fetch(`${url}/rest/v1/users?id=eq.${id}`, {
            method: 'DELETE',
            headers,
          });

          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, err?.status || 400, {
            error: err?.message || 'User admin request failed.',
          });
        }
      });
    },
  };
}
