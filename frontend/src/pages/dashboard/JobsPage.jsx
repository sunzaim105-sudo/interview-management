import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import JobFormModal from '../../components/team/JobFormModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { canEditWorkspace, isTeamMemberRole } from '../../lib/roles';
import { createJob, deleteJobs, fetchJobs } from '../../lib/teamApi';
import './TeamManagementPage.css';

function JobsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = canEditWorkspace(profile?.user_role);
  const isTeamMember = isTeamMemberRole(profile?.user_role);
  const [jobs, setJobs] = useState([]);
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchJobs();
      setJobs(rows);
      setSelectedJobIds([]);
    } catch (err) {
      setError(err.message || 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteMessage = useMemo(() => {
    const count = selectedJobIds.length;
    return `Delete ${count} job${count === 1 ? '' : 's'}? This cannot be undone.`;
  }, [selectedJobIds.length]);

  function toggleJobSelection(id, event) {
    event.stopPropagation();
    setSelectedJobIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function handleCreateJob(payload) {
    try {
      await createJob(payload);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to create job.');
      throw err;
    }
  }

  async function confirmDeleteJobs() {
    if (!selectedJobIds.length) return;

    setBusy(true);
    setError('');
    try {
      await deleteJobs(selectedJobIds);
      setConfirmOpen(false);
      await loadData();
    } catch (err) {
      setError(
        err.message?.includes('foreign key')
          ? 'Cannot delete a job that is linked to interviews.'
          : err.message || 'Failed to delete jobs.',
      );
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="team-page">
      <header className="team-page__header">
        <div>
          <h1>Jobs</h1>
          <p>
            {isTeamMember
              ? 'Browse suggested jobs for interviews (read-only).'
              : 'Browse and manage suggested jobs for interviews.'}
          </p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="team-page__error">{error}</div> : null}
      {loading ? <div className="team-page__status">Loading...</div> : null}

      {!loading ? (
        <section className="team-panel" aria-label="Jobs">
          <div className="team-panel__toolbar">
            <div>
              <h2>Suggested jobs</h2>
              <p>
                {jobs.length} job{jobs.length === 1 ? '' : 's'}
              </p>
            </div>
            {canEdit ? (
              <div className="team-panel__actions">
                <button
                  type="button"
                  className="team-btn-danger"
                  disabled={!selectedJobIds.length || busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="team-btn-primary"
                  onClick={() => setJobFormOpen(true)}
                >
                  + Add
                </button>
              </div>
            ) : (
              <p className="team-panel__readonly">Read-only</p>
            )}
          </div>

          <div className="job-accordion" role="list">
            {jobs.length === 0 ? (
              <div className="job-accordion__empty">
                {canEdit
                  ? 'No jobs yet. Click Add to create a suggested job.'
                  : 'No jobs available for your account.'}
              </div>
            ) : (
              jobs.map((job) => {
                const expanded = expandedJobId === job.id;
                return (
                  <article
                    key={job.id}
                    className={`job-accordion__item${expanded ? ' is-open' : ''}`}
                    role="listitem"
                  >
                    <div className="job-accordion__head">
                      {canEdit ? (
                        <label
                          className="job-accordion__check"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedJobIds.includes(job.id)}
                            onChange={(event) =>
                              toggleJobSelection(job.id, event)
                            }
                            aria-label={`Select ${job.job_title}`}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        className="job-accordion__trigger"
                        onClick={() => navigate(`/dashboard/jobs/${job.id}`)}
                      >
                        <div>
                          <strong>{job.job_title}</strong>
                          <span>{job.company_name}</span>
                          {job.job_link ? (
                            <span className="job-accordion__link">
                              {job.job_link}
                            </span>
                          ) : (
                            <span className="job-accordion__link is-missing">
                              Missing job link
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="job-accordion__toggle"
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Collapse job' : 'Expand job'}
                        onClick={() =>
                          setExpandedJobId((current) =>
                            current === job.id ? null : job.id,
                          )
                        }
                      >
                        ▾
                      </button>
                    </div>
                    {expanded ? (
                      <div className="job-accordion__body">
                        <p>
                          {[
                            job.workplace_location,
                            job.work_setup,
                            job.salary,
                            job.required_level,
                            job.required_experience,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'No extra details yet.'}
                        </p>
                        {job.job_link ? (
                          <p>
                            <a
                              href={job.job_link}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {job.job_link}
                            </a>
                          </p>
                        ) : (
                          <p className="job-accordion__link is-missing">
                            Missing job link
                          </p>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <>
          <JobFormModal
            open={jobFormOpen}
            onClose={() => setJobFormOpen(false)}
            onSubmit={handleCreateJob}
          />

          <ConfirmDialog
            open={confirmOpen}
            title="Delete jobs"
            message={deleteMessage}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            busy={busy}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={confirmDeleteJobs}
          />
        </>
      ) : null}
    </div>
  );
}

export default JobsPage;
