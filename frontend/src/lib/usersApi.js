import { supabase } from './supabase';

const USER_SELECT =
  'id, username, user_id, user_role, email, status, created_at, updated_at';

export async function fetchUsers() {
  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function updateUser(id, payload) {
  const { data, error } = await supabase
    .from('users')
    .update(payload)
    .eq('id', id)
    .select(USER_SELECT)
    .single();

  if (error) throw error;
  return data;
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  return token;
}

export async function createUserAccount(payload) {
  const accessToken = await getAccessToken();
  const response = await fetch('/api/users/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ ...payload, accessToken }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Failed to create user.');
  }
  return body.data;
}

export async function deleteUserAccount(id) {
  const accessToken = await getAccessToken();
  const response = await fetch('/api/users/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ id, accessToken }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Failed to delete user.');
  }
}
