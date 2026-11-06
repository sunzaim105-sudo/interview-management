import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import { fetchJobById } from '../../lib/teamApi';
import './TeamDetailPages.css';

function JobDetailPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [frameBlocked, setFrameBlocked] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      setFrameBlocked(false);
      try {
        const row = await fetchJobById(jobId);
        if (active) setJob(row);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load job.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [jobId]);

  return (
    <div className="team-detail">
      <header className="team-detail__header">
        <div>
          <button
            type="button"
            className="team-detail__back"
            onClick={() => navigate('/dashboard/jobs')}
          >
            ← Back to jobs
          </button>
          <h1>Job details</h1>
          <p>Key job facts and the original posting page.</p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="team-detail__error">{error}</div> : null}
      {loading ? <div className="team-detail__status">Loading...</div> : null}

      {!loading && job ? (
        <div className="team-detail__grid team-detail__grid--job">
          <section className="team-detail__card team-detail__job-meta">
            <div className="team-detail__job-head">
              <h2>{job.job_title}</h2>
              <p>{job.company_name}</p>
            </div>

            <dl className="team-detail__fields team-detail__fields--stack">
              <div className="team-detail__field">
                <dt>Company</dt>
                <dd>{job.company_name}</dd>
              </div>
              <div className="team-detail__field">
                <dt>Workplace location</dt>
                <dd>{job.workplace_location || '—'}</dd>
              </div>
              <div className="team-detail__field">
                <dt>Work setup</dt>
                <dd>{job.work_setup || '—'}</dd>
              </div>
              <div className="team-detail__field">
                <dt>Salary</dt>
                <dd>{job.salary || '—'}</dd>
              </div>
              <div className="team-detail__field">
                <dt>Required level</dt>
                <dd>{job.required_level || '—'}</dd>
              </div>
              <div className="team-detail__field">
                <dt>Required experience</dt>
                <dd>{job.required_experience || '—'}</dd>
              </div>
              <div className="team-detail__field">
                <dt>Job link</dt>
                <dd>
                  {job.job_link ? (
                    <a href={job.job_link} target="_blank" rel="noreferrer">
                      {job.job_link}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="team-detail__field">
                <dt>Created</dt>
                <dd>{formatDate(job.created_at)}</dd>
              </div>
            </dl>
          </section>

          <section className="team-detail__card team-detail__job-preview">
            <div className="team-detail__job-preview-head">
              <div>
                <h2>Job posting</h2>
                <p>Live page from the job link.</p>
              </div>
              {job.job_link ? (
                <a
                  className="team-detail__resume-link"
                  href={job.job_link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in new tab
                </a>
              ) : null}
            </div>

            {job.job_link ? (
              <div className="team-detail__job-frame">
                {frameBlocked ? (
                  <div className="team-detail__resume-empty">
                    This site blocks embedded previews. Use Open in new tab to
                    view the posting.
                  </div>
                ) : (
                  <iframe
                    title={`${job.job_title} posting`}
                    src={job.job_link}
                    referrerPolicy="no-referrer"
                    onError={() => setFrameBlocked(true)}
                  />
                )}
              </div>
            ) : (
              <div className="team-detail__resume-empty">
                No job link available for this posting.
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!loading && !job && !error ? (
        <div className="team-detail__status">
          Job not found. <Link to="/dashboard/jobs">Return to jobs</Link>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default JobDetailPage;
