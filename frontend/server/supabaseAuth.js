/**
 * Shared Supabase auth helpers for Vite middleware plugins.
 */

export function getBearerToken(req, body = {}) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return String(body.accessToken || '').trim();
}

export function serviceHeaders(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(
      new Error(
        'Set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in frontend/.env.',
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

async function fetchAuthUser(env, accessToken) {
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const service = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || (!anon && !service)) {
    throw Object.assign(new Error('Supabase env is not configured.'), {
      status: 500,
    });
  }

  const keys = [service, anon].filter(Boolean);
  let last = {};
  for (const apikey of keys) {
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${accessToken}` },
    });
    const authUser = await userRes.json().catch(() => ({}));
    if (userRes.ok && authUser?.id) return authUser;
    last = authUser;
  }
  throw Object.assign(
    new Error(
      last?.msg ||
        last?.error_description ||
        last?.error ||
        'Invalid session.',
    ),
    { status: 401 },
  );
}

async function fetchProfile(env, userId, accessToken) {
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const service = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  const apikey = service || anon;
  const authHeader = service ? `Bearer ${service}` : `Bearer ${accessToken}`;
  const profileRes = await fetch(
    `${url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=id,user_role,status,email,username`,
    {
      headers: {
        apikey,
        Authorization: authHeader,
      },
    },
  );
  const profiles = await profileRes.json().catch(() => []);
  return Array.isArray(profiles) ? profiles[0] : null;
}

/** Any allowed signed-in user (admin / caller / team_member). */
export async function assertAllowedUser(env, accessToken) {
  if (!accessToken) {
    throw Object.assign(new Error('Missing access token.'), { status: 401 });
  }
  const authUser = await fetchAuthUser(env, accessToken);
  const profile = await fetchProfile(env, authUser.id, accessToken);
  if (!profile || profile.status !== 'allowed') {
    throw Object.assign(new Error('Account is not allowed.'), { status: 403 });
  }
  return { authUser, profile };
}

/** Allowed admin only. */
export async function assertAllowedAdmin(env, accessToken) {
  const access = await assertAllowedUser(env, accessToken);
  if (access.profile.user_role !== 'admin') {
    throw Object.assign(new Error('Admin access required.'), { status: 403 });
  }
  return access;
}

/** Admin or other roles that may edit workspace data (jobs/team). */
export async function assertWorkspaceEditor(env, accessToken) {
  const access = await assertAllowedUser(env, accessToken);
  if (access.profile.user_role !== 'admin') {
    throw Object.assign(
      new Error('Only admins can perform this action.'),
      { status: 403 },
    );
  }
  return access;
}
