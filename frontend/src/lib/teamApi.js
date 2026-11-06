import { supabase } from './supabase';

const MEMBER_SELECT =
  'id, name, professional_title, email, phone_number, location, resume_file, created_at, updated_at';

const JOB_SELECT =
  'id, job_title, company_name, job_link, workplace_location, work_setup, salary, required_level, required_experience, created_at, updated_at';

const RESUME_BUCKET = 'resumes';

export async function fetchTeamMembers() {
  const { data, error } = await supabase
    .from('teammembers')
    .select(MEMBER_SELECT)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function fetchTeamMemberById(id) {
  const { data, error } = await supabase
    .from('teammembers')
    .select(MEMBER_SELECT)
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function createTeamMember(payload) {
  const { data, error } = await supabase
    .from('teammembers')
    .insert(payload)
    .select(MEMBER_SELECT)
    .single();

  if (error) throw error;
  return data;
}

export async function updateTeamMember(id, payload) {
  const { data, error } = await supabase
    .from('teammembers')
    .update(payload)
    .eq('id', id)
    .select(MEMBER_SELECT)
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTeamMembers(ids) {
  if (!ids?.length) return;

  const members = await Promise.all(ids.map((id) => fetchTeamMemberById(id)));
  const resumePaths = members
    .map((member) => member.resume_file)
    .filter(Boolean);

  const { error } = await supabase.from('teammembers').delete().in('id', ids);
  if (error) throw error;

  if (resumePaths.length) {
    await supabase.storage.from(RESUME_BUCKET).remove(resumePaths);
  }
}

export async function uploadResume(memberId, file) {
  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.'))
    : '';
  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
  const path = `${memberId}/${Date.now()}-${safeName || `resume${extension}`}`;

  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('teammembers')
    .update({ resume_file: path })
    .eq('id', memberId)
    .select(MEMBER_SELECT)
    .single();

  if (error) throw error;
  return data;
}

export async function getResumeSignedUrl(path, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data?.signedUrl || null;
}

export async function fetchJobs() {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchJobById(id) {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

function normalizeJobKeyPart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Same title + company + location (case-insensitive) is treated as a duplicate. */
export function isSameJobPosting(a, b) {
  return (
    normalizeJobKeyPart(a?.job_title) === normalizeJobKeyPart(b?.job_title) &&
    normalizeJobKeyPart(a?.company_name) === normalizeJobKeyPart(b?.company_name) &&
    normalizeJobKeyPart(a?.workplace_location) ===
      normalizeJobKeyPart(b?.workplace_location)
  );
}

export async function findDuplicateJob(payload) {
  const title = String(payload?.job_title || '').trim();
  const company = String(payload?.company_name || '').trim();
  if (!title || !company) return null;

  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .ilike('job_title', title)
    .ilike('company_name', company);

  if (error) throw error;
  return (data || []).find((row) => isSameJobPosting(row, payload)) || null;
}

export async function createJob(payload) {
  const duplicate = await findDuplicateJob(payload);
  if (duplicate) {
    throw new Error(
      `A job with the same title, company, and location already exists (“${duplicate.job_title}” at ${duplicate.company_name}${
        duplicate.workplace_location ? `, ${duplicate.workplace_location}` : ''
      }).`,
    );
  }

  const { data, error } = await supabase
    .from('jobs')
    .insert(payload)
    .select(JOB_SELECT)
    .single();

  if (error) {
    if (
      error.code === '23505' ||
      /duplicate|unique/i.test(String(error.message || ''))
    ) {
      throw new Error(
        'A job with the same title, company, and location already exists.',
      );
    }
    throw error;
  }
  return data;
}

export async function deleteJobs(ids) {
  if (!ids?.length) return;
  const { error } = await supabase.from('jobs').delete().in('id', ids);
  if (error) throw error;
}
