import {
  deleteDriveVideo,
  downloadDriveVideo,
  extractDriveFileId,
  getDriveWatchPayload,
  isDriveVideoPath,
  uploadFileViaDriveProxy,
  validateInterviewVideoFile,
} from './driveVideoApi';
import { supabase } from './supabase';

const VIDEO_BUCKET = 'interview-videos';

const INTERVIEW_SELECT = `
  id,
  interview_name,
  caller_id,
  invited_member_id,
  job_id,
  meeting_link,
  booking_note,
  stage,
  result,
  video_path,
  start_time,
  end_time,
  created_by,
  created_at,
  updated_at,
  caller:users!interviews_caller_id_fkey (
    id,
    username,
    user_id,
    email,
    profile:callers!callers_id_fkey (
      name,
      location,
      email,
      whatsapp_number,
      linkedin_url,
      freelancer_profile_url
    )
  ),
  invited_member:teammembers!interviews_invited_member_id_fkey (
    id,
    name,
    professional_title,
    email
  ),
  job:jobs!interviews_job_id_fkey (
    id,
    job_title,
    company_name,
    job_link
  )
`;

export async function fetchCallers() {
  const { data, error } = await supabase
    .from('callers')
    .select(
      `
      id,
      name,
      location,
      email,
      whatsapp_number,
      linkedin_url,
      freelancer_profile_url,
      notes,
      active,
      user:users!callers_id_fkey (
        id,
        username,
        user_id,
        email,
        user_role,
        status
      )
    `,
    )
    .eq('active', true)
    .order('name');

  if (error) {
    // Fallback while callers profile columns are rolling out
    const fallback = await supabase
      .from('users')
      .select('id, username, user_id, email, user_role, status')
      .eq('user_role', 'caller')
      .eq('status', 'allowed')
      .order('username');
    if (fallback.error) throw error;
    return fallback.data || [];
  }

  return (data || [])
    .map((row) => ({
      id: row.id,
      name: row.name || row.user?.username || 'Caller',
      location: row.location || '',
      email: row.email || row.user?.email || '',
      whatsapp_number: row.whatsapp_number || '',
      linkedin_url: row.linkedin_url || '',
      freelancer_profile_url: row.freelancer_profile_url || '',
      notes: row.notes,
      active: row.active,
      username: row.user?.username || row.name || 'Caller',
      user_id: row.user?.user_id || '',
      user_role: row.user?.user_role || 'caller',
      status: row.user?.status || 'allowed',
    }))
    .filter((row) => row.status === 'allowed')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchTeamMembers() {
  const { data, error } = await supabase
    .from('teammembers')
    .select(
      'id, name, professional_title, email, phone_number, location, resume_file',
    )
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function fetchJobs() {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, job_title, company_name, job_link, workplace_location, work_setup, salary, required_level, required_experience',
    )
    .order('job_title');

  if (error) throw error;
  return data || [];
}

export async function fetchInterviews({ from, to, callerOnlyId } = {}) {
  let query = supabase
    .from('interviews')
    .select(INTERVIEW_SELECT)
    .order('start_time', { ascending: true });

  if (from) query = query.gte('start_time', from.toISOString());
  if (to) query = query.lte('start_time', to.toISOString());
  if (callerOnlyId) query = query.eq('caller_id', callerOnlyId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createInterview(payload) {
  const { data, error } = await supabase
    .from('interviews')
    .insert(payload)
    .select(INTERVIEW_SELECT)
    .single();

  if (error) throw error;
  return data;
}

/** True when the scheduled interview end time is in the past. */
export function interviewHasConcluded(interview) {
  const end = new Date(interview?.end_time || 0).getTime();
  return Number.isFinite(end) && end > 0 && Date.now() >= end;
}

export async function updateInterview(id, payload) {
  const next = payload || {};
  const touchesStage = Object.prototype.hasOwnProperty.call(next, 'stage');
  const touchesResult = Object.prototype.hasOwnProperty.call(next, 'result');
  const touchesVideo = Object.prototype.hasOwnProperty.call(next, 'video_path');
  const clearingVideo = touchesVideo && !String(next.video_path || '').trim();
  const addingResult =
    touchesStage || touchesResult || (touchesVideo && !clearingVideo);

  if (addingResult) {
    const { data: row, error: readError } = await supabase
      .from('interviews')
      .select('id, end_time')
      .eq('id', id)
      .single();
    if (readError) throw readError;
    if (!interviewHasConcluded(row)) {
      throw new Error(
        'Interview results can only be added after the interview session has concluded.',
      );
    }
  }

  const { data, error } = await supabase
    .from('interviews')
    .update(payload)
    .eq('id', id)
    .select(INTERVIEW_SELECT)
    .single();

  if (error) throw error;
  return data;
}

export async function deleteInterview(id) {
  const { error } = await supabase.from('interviews').delete().eq('id', id);
  if (error) throw error;
}

function sanitizeVideoName(filename = 'recording.mp4') {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return safe || 'recording.mp4';
}

/**
 * Upload interview video to Google Drive, then store the Drive file URL in
 * interviews.video_path. onProgress receives 0-100.
 */
export async function uploadInterviewVideo(
  interviewId,
  file,
  previousPath = '',
  onProgress,
) {
  if (!interviewId || !file) {
    throw new Error('Interview and video file are required.');
  }

  const { data: interviewRow, error: interviewError } = await supabase
    .from('interviews')
    .select('id, end_time, caller_id')
    .eq('id', interviewId)
    .single();
  if (interviewError) throw interviewError;
  if (!interviewHasConcluded(interviewRow)) {
    throw new Error(
      'Interview results can only be added after the interview session has concluded.',
    );
  }

  const { mimeType } = validateInterviewVideoFile(file);
  onProgress?.(1);

  const completed = await uploadFileViaDriveProxy({
    interviewId,
    file,
    mimeType,
    filename: sanitizeVideoName(file.name),
    previousVideoPath: previousPath,
    onProgress: (percent) => {
      onProgress?.(Math.min(97, Math.max(1, percent)));
    },
  });

  const updated = await updateInterview(interviewId, {
    video_path: completed.fileUrl,
  });
  onProgress?.(100);

  // Clean up legacy Supabase storage paths if replacing an old upload
  if (previousPath && !isDriveVideoPath(previousPath)) {
    await supabase.storage.from(VIDEO_BUCKET).remove([previousPath]);
  }

  return updated;
}

export async function clearInterviewVideo(interviewId, path) {
  if (path) {
    if (isDriveVideoPath(path) && extractDriveFileId(path)) {
      await deleteDriveVideo({ interviewId, videoPath: path });
    } else {
      await supabase.storage.from(VIDEO_BUCKET).remove([path]);
    }
  }
  return updateInterview(interviewId, { video_path: '' });
}

export async function getInterviewVideoPlayback(interviewId, path) {
  if (!path) return null;

  if (isDriveVideoPath(path)) {
    const data = await getDriveWatchPayload({ interviewId, videoPath: path });
    // Prefer authenticated stream proxy so private Drive files play in-app.
    return {
      kind: 'drive',
      url: data.streamUrl || '',
      streamUrl: data.streamUrl,
      previewUrl: '',
      fileUrl: data.fileUrl,
    };
  }

  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return {
    kind: 'storage',
    url: data?.signedUrl || null,
  };
}

/** @deprecated use getInterviewVideoPlayback */
export async function getInterviewVideoSignedUrl(path, expiresIn = 3600) {
  if (!path) return null;
  if (isDriveVideoPath(path)) {
    const data = await getDriveWatchPayload({ videoPath: path });
    return data.streamUrl || data.previewUrl;
  }
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function downloadInterviewVideo(
  path,
  filename = 'interview-video.mp4',
  interviewId = '',
) {
  if (!path) throw new Error('No video available.');

  if (isDriveVideoPath(path)) {
    await downloadDriveVideo({ interviewId, videoPath: path, filename });
    return;
  }

  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).download(path);
  if (error) throw error;

  const url = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
