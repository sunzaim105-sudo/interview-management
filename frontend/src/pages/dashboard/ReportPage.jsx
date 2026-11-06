import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import {
  formatDisplayDate,
  formatTimeBySetting,
  loadCalendarSettings,
} from '../../lib/calendarSettings';
import { fetchDriveStatus, startDriveConnect } from '../../lib/driveVideoApi';
import {
  DEFAULT_INTERVIEW_STAGE,
  INTERVIEW_STAGES,
} from '../../lib/interviewStages';
import {
  clearInterviewVideo,
  deleteInterview,
  downloadInterviewVideo,
  fetchCallers,
  fetchInterviews,
  fetchTeamMembers,
  getInterviewVideoPlayback,
  interviewHasConcluded,
  updateInterview,
  uploadInterviewVideo,
} from '../../lib/interviewsApi';
import {
  canEditWorkspace,
  interviewCallerScopeId,
  isCallerRole,
  isTeamMemberRole,
} from '../../lib/roles';
import './ReportPage.css';

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov';

function ReportPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canEdit = canEditWorkspace(profile?.user_role);
  const isCaller = isCallerRole(profile?.user_role);
  const isTeamMember = isTeamMemberRole(profile?.user_role);
  const callerScopeId = interviewCallerScopeId(profile);
  const showCallerFilter = !callerScopeId;
  const settings = useMemo(() => loadCalendarSettings(), []);
  const fileInputs = useRef({});
  const driveJustConnected = useRef(false);

  const [interviews, setInterviews] = useState([]);
  const [callers, setCallers] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [callerFilter, setCallerFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [driveConfigured, setDriveConfigured] = useState(true);
  const [driveBusy, setDriveBusy] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [videoBusyId, setVideoBusyId] = useState('');
  const [uploadProgress, setUploadProgress] = useState({});
  const [preview, setPreview] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState('');

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const loadDirectory = !callerScopeId;
      const [interviewRows, callerRows, memberRows, drive] = await Promise.all([
        fetchInterviews({
          callerOnlyId: callerScopeId || undefined,
        }),
        loadDirectory ? fetchCallers() : Promise.resolve([]),
        loadDirectory ? fetchTeamMembers() : Promise.resolve([]),
        fetchDriveStatus().catch(() => ({ configured: false })),
      ]);
      setInterviews(interviewRows);
      setCallers(callerRows);
      setTeamMembers(memberRows);
      if (!driveJustConnected.current) {
        setDriveConfigured(Boolean(drive?.configured));
      }
    } catch (err) {
      setError(err.message || 'Failed to load report data.');
    } finally {
      setLoading(false);
    }
  }, [profile, callerScopeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (searchParams.get('drive_connected')) {
      driveJustConnected.current = true;
      setStatus('Google Drive connected. You can upload interview videos.');
      setDriveConfigured(true);
      navigate('/dashboard/report', { replace: true });
      fetchDriveStatus()
        .then((drive) => setDriveConfigured(Boolean(drive?.configured)))
        .catch(() => setDriveConfigured(true));
      return;
    }
    const driveError = searchParams.get('drive_error');
    if (driveError) {
      setError(decodeURIComponent(driveError));
      navigate('/dashboard/report', { replace: true });
    }
  }, [searchParams, navigate]);

  async function handleConnectDrive() {
    setDriveBusy(true);
    setError('');
    try {
      sessionStorage.setItem('drive_oauth_return', '/dashboard/report');
      const authUrl = await startDriveConnect();
      window.location.assign(authUrl);
    } catch (err) {
      setError(err.message || 'Failed to start Google Drive connection.');
      setDriveBusy(false);
    }
  }

  const filterCallers = useMemo(() => {
    if (callers.length) return callers;
    const map = new Map();
    for (const item of interviews) {
      if (!item.caller?.id) continue;
      map.set(item.caller.id, {
        id: item.caller.id,
        username: item.caller.profile?.name || item.caller.username,
        name: item.caller.profile?.name || item.caller.username,
      });
    }
    return [...map.values()];
  }, [callers, interviews]);

  const filterMembers = useMemo(() => {
    if (teamMembers.length) return teamMembers;
    const map = new Map();
    for (const item of interviews) {
      if (!item.invited_member?.id) continue;
      map.set(item.invited_member.id, {
        id: item.invited_member.id,
        name: item.invited_member.name,
      });
    }
    return [...map.values()];
  }, [teamMembers, interviews]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return interviews.filter((item) => {
      // Results appear only after the scheduled session has ended.
      if (!interviewHasConcluded(item)) return false;
      if (callerFilter !== 'all' && item.caller_id !== callerFilter) return false;
      if (memberFilter !== 'all' && item.invited_member_id !== memberFilter) {
        return false;
      }
      if (stageFilter !== 'all' && item.stage !== stageFilter) return false;
      if (!q) return true;
      return (
        item.interview_name?.toLowerCase().includes(q) ||
        item.job?.job_title?.toLowerCase().includes(q) ||
        item.job?.company_name?.toLowerCase().includes(q) ||
        item.caller?.username?.toLowerCase().includes(q) ||
        item.invited_member?.name?.toLowerCase().includes(q)
      );
    });
  }, [
    interviews,
    callerFilter,
    memberFilter,
    stageFilter,
    search,
  ]);

  async function patchInterview(item, payload) {
    if (!interviewHasConcluded(item)) {
      setError(
        'Interview results can only be added after the interview session has concluded.',
      );
      return;
    }
    setSavingId(item.id);
    setError('');
    try {
      const updated = await updateInterview(item.id, payload);
      setInterviews((current) =>
        current.map((row) => (row.id === item.id ? updated : row)),
      );
    } catch (err) {
      setError(err.message || 'Failed to update interview result.');
    } finally {
      setSavingId('');
    }
  }

  async function handleVideoUpload(item, file) {
    if (!file) return;
    if (!canUploadVideo(item)) {
      setError(
        interviewHasConcluded(item)
          ? 'You cannot upload a video for this interview.'
          : 'Interview results can only be added after the interview session has concluded.',
      );
      return;
    }
    const name = (file.name || '').toLowerCase();
    const allowedExt =
      name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov');
    const allowedMime = ['video/mp4', 'video/webm', 'video/quicktime'].includes(
      file.type,
    );
    if (!allowedMime && !allowedExt) {
      setError('Please choose an MP4, WebM, or MOV video.');
      return;
    }

    setVideoBusyId(item.id);
    setUploadProgress((current) => ({ ...current, [item.id]: 0 }));
    setError('');
    try {
      const updated = await uploadInterviewVideo(
        item.id,
        file,
        item.video_path,
        (percent) => {
          setUploadProgress((current) => ({
            ...current,
            [item.id]: percent,
          }));
        },
      );
      setInterviews((current) =>
        current.map((row) => (row.id === item.id ? updated : row)),
      );
      setStatus('Interview video uploaded.');
    } catch (err) {
      setError(err.message || 'Failed to upload interview video.');
    } finally {
      setVideoBusyId('');
      setUploadProgress((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
  }

  async function handleWatch(item) {
    setVideoBusyId(item.id);
    setError('');
    try {
      const playback = await getInterviewVideoPlayback(
        item.id,
        item.video_path,
      );
      if (!playback) throw new Error('Video is not available.');
      setPreview({
        title: item.interview_name,
        kind: playback.kind,
        url: playback.url || playback.streamUrl || '',
        previewUrl: playback.previewUrl || '',
      });
    } catch (err) {
      setError(err.message || 'Failed to open video.');
    } finally {
      setVideoBusyId('');
    }
  }

  async function handleDownload(item) {
    setVideoBusyId(item.id);
    setError('');
    try {
      const safe = (item.interview_name || 'interview')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 60);
      await downloadInterviewVideo(
        item.video_path,
        `${safe}.mp4`,
        item.id,
      );
    } catch (err) {
      setError(err.message || 'Failed to download video.');
    } finally {
      setVideoBusyId('');
    }
  }

  async function confirmDeleteResult() {
    const item = deleteTarget;
    if (!item) return;
    setDeletingId(item.id);
    setError('');
    try {
      if (item.video_path) {
        try {
          await clearInterviewVideo(item.id, item.video_path);
        } catch {
          // Still delete the interview row if Drive cleanup fails.
        }
      }
      await deleteInterview(item.id);
      setInterviews((current) => current.filter((row) => row.id !== item.id));
      setDeleteTarget(null);
      setStatus(`Deleted interview result “${item.interview_name}”.`);
    } catch (err) {
      setError(err.message || 'Failed to delete interview result.');
      setDeleteTarget(null);
    } finally {
      setDeletingId('');
    }
  }

  function canUploadVideo(item) {
    // Only the assigned caller may upload, and only after the interview ends.
    if (!isCaller || item.caller_id !== profile?.id) return false;
    return interviewHasConcluded(item);
  }

  function canWatchVideo(item) {
    if (canEdit || isTeamMember) return true;
    // Assigned caller can watch their own uploaded recording.
    return isCaller && item?.caller_id === profile?.id;
  }

  function canDownloadVideo() {
    return canEdit || isTeamMember;
  }

  function canDeleteResult() {
    return canEdit;
  }

  function canEditStage(item) {
    return canEdit && interviewHasConcluded(item);
  }

  return (
    <div className="report-page">
      <header className="report-page__header">
        <div>
          <h1>Report</h1>
          <p>
            {isTeamMember
              ? 'View interview stages, results, and recordings (read-only).'
              : 'Review interview stages, results, and recordings. Results and videos can only be added after the interview session has concluded.'}
          </p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="report-page__error">{error}</div> : null}
      {status ? <div className="report-page__status">{status}</div> : null}

      {!driveConfigured && canEdit ? (
        <div className="report-page__error">
          Google Drive is not connected.{' '}
          <button
            type="button"
            className="report-video-btn report-video-btn--primary"
            disabled={driveBusy}
            onClick={handleConnectDrive}
          >
            {driveBusy ? 'Redirecting…' : 'Connect Google Drive'}
          </button>
        </div>
      ) : null}

      <div className="report-page__body">
        <aside className="report-filters" aria-label="Report filters">
          <div className="report-filters__head">
            <strong>Filters</strong>
            <button
              type="button"
              className="report-filters__reset"
              onClick={() => {
                setCallerFilter('all');
                setMemberFilter('all');
                setStageFilter('all');
                setSearch('');
              }}
            >
              Reset
            </button>
          </div>

          <label className="report-field">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, job, caller..."
            />
          </label>

          {showCallerFilter ? (
            <label className="report-field">
              <span>Caller</span>
              <select
                value={callerFilter}
                onChange={(e) => setCallerFilter(e.target.value)}
              >
                <option value="all">All callers</option>
                {filterCallers.map((caller) => (
                  <option key={caller.id} value={caller.id}>
                    {caller.name || caller.username}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="report-field">
            <span>Invited team member</span>
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
            >
              <option value="all">All members</option>
              {filterMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="report-field">
            <span>Stage</span>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="all">All stages</option>
              {INTERVIEW_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </label>

        </aside>

        <section className="report-table-panel" aria-label="Interview results">
          <div className="report-table-panel__toolbar">
            <div>
              <h2>Interview results</h2>
              <p>
                {loading
                  ? 'Loading...'
                  : `${rows.length} interview${rows.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Interview</th>
                  <th>Date / Time</th>
                  <th>Job</th>
                  <th>Caller</th>
                  <th>Invited member</th>
                  <th>Stage</th>
                  <th>Video</th>
                </tr>
              </thead>
              <tbody>
                {!loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="report-table__empty">
                      No concluded interview results yet. Sessions appear here
                      after their end time.
                    </td>
                  </tr>
                ) : null}
                {rows.map((item) => {
                  const start = new Date(item.start_time);
                  const end = new Date(item.end_time);
                  const busy =
                    savingId === item.id ||
                    videoBusyId === item.id ||
                    deletingId === item.id;
                  const hasVideo = Boolean(item.video_path);
                  const progress = uploadProgress[item.id];
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.interview_name}</strong>
                        {item.booking_note ? (
                          <span className="report-table__note">
                            {item.booking_note}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <div>
                          {formatDisplayDate(
                            start,
                            settings.dateFormat,
                            settings.timeZone,
                          )}
                        </div>
                        <span className="report-table__muted">
                          {formatTimeBySetting(
                            start,
                            settings.timeFormat,
                            settings.timeZone,
                          )}
                          {' – '}
                          {formatTimeBySetting(
                            end,
                            settings.timeFormat,
                            settings.timeZone,
                          )}
                        </span>
                      </td>
                      <td>
                        <div>{item.job?.job_title || '—'}</div>
                        <span className="report-table__muted">
                          {item.job?.company_name || ''}
                        </span>
                      </td>
                      <td>
                        {item.caller?.profile?.name ||
                          item.caller?.username ||
                          '—'}
                      </td>
                      <td>{item.invited_member?.name || '—'}</td>
                      <td>
                        {canEditStage(item) ? (
                          <select
                            className="report-inline-select"
                            value={item.stage || DEFAULT_INTERVIEW_STAGE}
                            disabled={busy}
                            onChange={(e) =>
                              patchInterview(item, { stage: e.target.value })
                            }
                          >
                            {INTERVIEW_STAGES.map((stage) => (
                              <option key={stage} value={stage}>
                                {stage}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div>
                            <div>{item.stage || DEFAULT_INTERVIEW_STAGE}</div>
                            {!interviewHasConcluded(item) ? (
                              <span className="report-table__muted">
                                Locked until session ends
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="report-video-actions">
                          {hasVideo && canWatchVideo(item) ? (
                            <button
                              type="button"
                              className="report-video-btn"
                              disabled={busy}
                              onClick={() => handleWatch(item)}
                            >
                              Watch
                            </button>
                          ) : null}

                          {!hasVideo &&
                          progress == null &&
                          !canUploadVideo(item) ? (
                            <span className="report-table__muted">
                              {interviewHasConcluded(item)
                                ? 'No video'
                                : 'Locked until session ends'}
                            </span>
                          ) : null}

                          {hasVideo && canDownloadVideo() ? (
                            <button
                              type="button"
                              className="report-video-btn"
                              disabled={busy}
                              onClick={() => handleDownload(item)}
                            >
                              Download
                            </button>
                          ) : null}

                          {canUploadVideo(item) ? (
                            <>
                              <input
                                ref={(el) => {
                                  fileInputs.current[item.id] = el;
                                }}
                                type="file"
                                accept={VIDEO_ACCEPT}
                                hidden
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = '';
                                  handleVideoUpload(item, file);
                                }}
                              />
                              <button
                                type="button"
                                className="report-video-btn report-video-btn--primary"
                                disabled={busy}
                                onClick={() =>
                                  fileInputs.current[item.id]?.click()
                                }
                              >
                                {progress != null
                                  ? `Uploading ${progress}%`
                                  : hasVideo
                                    ? 'Replace'
                                    : 'Upload'}
                              </button>
                            </>
                          ) : null}

                          {canDeleteResult() ? (
                            <button
                              type="button"
                              className="report-video-btn report-video-btn--danger"
                              disabled={busy}
                              onClick={() => setDeleteTarget(item)}
                            >
                              Delete
                            </button>
                          ) : null}

                          {progress != null ? (
                            <div
                              className="report-video-progress"
                              role="progressbar"
                              aria-valuenow={progress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <span style={{ width: `${progress}%` }} />
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {preview ? (
        <div
          className="report-video-modal-backdrop"
          onClick={() => setPreview(null)}
        >
          <div
            className="report-video-modal"
            role="dialog"
            aria-modal="true"
            aria-label={preview.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="report-video-modal__head">
              <strong>{preview.title}</strong>
              <button
                type="button"
                className="report-video-modal__close"
                onClick={() => setPreview(null)}
              >
                ×
              </button>
            </div>
            <video
              src={preview.url || preview.streamUrl || ''}
              controls
              autoPlay
              className="report-video-player"
            />
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete interview result?"
        message={
          deleteTarget
            ? `Delete “${deleteTarget.interview_name}” from Interview results? Any uploaded video will also be removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete result"
        busy={Boolean(deleteTarget && deletingId === deleteTarget.id)}
        onConfirm={confirmDeleteResult}
        onCancel={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
      />
    </div>
  );
}

export default ReportPage;
