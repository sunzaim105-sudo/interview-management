/**
 * Creates an allowed caller account for testing.
 * Usage (PowerShell):
 *   $env:SUPABASE_URL="https://....supabase.co"
 *   $env:SUPABASE_SECRET_KEY="sb_secret_..."
 *   node supabase/create_test_caller.js
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

const caller = {
  email: 'test.caller@calid.dev',
  password: 'Caller123!)!)',
  username: 'Test Caller',
  user_id: 'Test_Caller_1001',
  user_role: 'caller',
};

async function main() {
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: caller.email,
      password: caller.password,
      email_confirm: true,
      user_metadata: {
        username: caller.username,
        user_id: caller.user_id,
        user_role: caller.user_role,
      },
    }),
  });

  const created = await createRes.json();
  console.log('create status', createRes.status);

  let authUserId = created?.id || created?.user?.id;

  if (!createRes.ok) {
    // If already exists, look up by email
    const listRes = await fetch(
      `${url}/auth/v1/admin/users?page=1&per_page=200`,
      { headers },
    );
    const list = await listRes.json();
    const found = (list?.users || []).find((u) => u.email === caller.email);
    if (!found) {
      console.error(created);
      process.exit(1);
    }
    authUserId = found.id;
    console.log('caller auth user already exists', authUserId);
  } else {
    console.log('created auth user', authUserId);
  }

  const upsertRes = await fetch(`${url}/rest/v1/users?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      id: authUserId,
      username: caller.username,
      user_id: caller.user_id,
      user_role: 'caller',
      email: caller.email,
      status: 'allowed',
    }),
  });

  console.log('profile status', upsertRes.status, await upsertRes.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
