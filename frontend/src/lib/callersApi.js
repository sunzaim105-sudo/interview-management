import { supabase } from './supabase';

const CALLER_SELECT = `
  id,
  name,
  location,
  email,
  whatsapp_number,
  linkedin_url,
  freelancer_profile_url,
  notes,
  active,
  created_at,
  updated_at,
  user:users!callers_id_fkey (
    id,
    username,
    user_id,
    email,
    user_role,
    status
  )
`;

function mapCaller(row) {
  return {
    id: row.id,
    name: row.name || row.user?.username || 'Caller',
    location: row.location || '',
    email: row.email || row.user?.email || '',
    whatsapp_number: row.whatsapp_number || '',
    linkedin_url: row.linkedin_url || '',
    freelancer_profile_url: row.freelancer_profile_url || '',
    notes: row.notes || '',
    active: row.active !== false,
    username: row.user?.username || row.name || 'Caller',
    user_id: row.user?.user_id || '',
    user_role: row.user?.user_role || 'caller',
    status: row.user?.status || 'allowed',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchCallerProfiles({ activeOnly = false } = {}) {
  let query = supabase
    .from('callers')
    .select(CALLER_SELECT)
    .order('name', { ascending: true });

  if (activeOnly) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapCaller);
}

export async function fetchCallerById(id) {
  const { data, error } = await supabase
    .from('callers')
    .select(CALLER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCaller(data) : null;
}

export async function updateCallerProfile(id, payload) {
  const { data, error } = await supabase
    .from('callers')
    .update(payload)
    .eq('id', id)
    .select(CALLER_SELECT)
    .single();
  if (error) throw error;
  return mapCaller(data);
}

export async function ensureCallerProfile(user) {
  if (!user?.id) return null;
  const existing = await fetchCallerById(user.id);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('callers')
    .upsert(
      {
        id: user.id,
        active: user.status === 'allowed',
        name: user.username || '',
        email: user.email || '',
      },
      { onConflict: 'id' },
    )
    .select(CALLER_SELECT)
    .single();
  if (error) throw error;
  return mapCaller(data);
}
