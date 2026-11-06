import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import { useAuth } from '../../context/AuthContext';
import { canEditWorkspace } from '../../lib/roles';
import {
  fetchTeamMemberById,
  getResumeSignedUrl,
  uploadResume,
} from '../../lib/teamApi';
import './TeamDetailPages.css';

function TeamMemberDetailPage() {
  const { memberId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = canEditWorkspace(profile?.user_role);
  const [member, setMember] = useState(null);
  const [resumeUrl, setResumeUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const row = await fetchTeamMemberById(memberId);
        if (!active) return;
        setMember(row);
        if (row.resume_file) {
          const url = await getResumeSignedUrl(row.resume_file);
          if (active) setResumeUrl(url);
        } else {
          setResumeUrl(null);
        }
      } catch (err) {
        if (active) setError(err.message || 'Failed to load team member.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [memberId]);

  async function handleResumeUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !member) return;

    setUploading(true);
    setError('');
    try {
      const updated = await uploadResume(member.id, file);
      setMember(updated);
      const url = await getResumeSignedUrl(updated.resume_file);
      setResumeUrl(url);
    } catch (err) {
      setError(err.message || 'Failed to upload resume.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  const fields = member
    ? [
        { label: 'Name', value: member.name },
        { label: 'Professional title', value: member.professional_title || '—' },
        { label: 'Email', value: member.email },
        { label: 'Phone', value: member.phone_number || '—' },
        { label: 'Location', value: member.location || '—' },
      ]
    : [];

  return (
    <div className="team-detail">
      <header className="team-detail__header">
        <div>
          <button
            type="button"
            className="team-detail__back"
            onClick={() => navigate('/dashboard/team')}
          >
            ← Back to team
          </button>
          <h1>Team member resume</h1>
          <p>Review profile details and uploaded resume.</p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="team-detail__error">{error}</div> : null}
      {loading ? <div className="team-detail__status">Loading...</div> : null}

      {!loading && member ? (
        <div className="team-detail__grid">
          <section className="team-detail__card">
            <div className="team-detail__identity">
              <div className="team-detail__avatar" aria-hidden="true">
                {getInitials(member.name)}
              </div>
              <div>
                <h2>{member.name}</h2>
                <p>{member.professional_title || 'Team member'}</p>
              </div>
            </div>

            <dl className="team-detail__fields">
              {fields.map((field) => (
                <div key={field.label} className="team-detail__field">
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="team-detail__card team-detail__resume">
            <div className="team-detail__resume-head">
              <div>
                <h2>Resume</h2>
                <p>
                  {member.resume_file
                    ? 'Uploaded file is available below.'
                    : 'No resume uploaded yet.'}
                </p>
              </div>
              {canEdit ? (
                <label className="team-detail__upload">
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,application/pdf"
                    onChange={handleResumeUpload}
                    disabled={uploading}
                  />
                  <span>{uploading ? 'Uploading...' : 'Upload resume'}</span>
                </label>
              ) : null}
            </div>

            {resumeUrl ? (
              <div className="team-detail__resume-frame">
                <iframe title={`${member.name} resume`} src={resumeUrl} />
                <a
                  className="team-detail__resume-link"
                  href={resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open resume in new tab
                </a>
              </div>
            ) : (
              <div className="team-detail__resume-empty">
                {canEdit
                  ? 'Upload a PDF resume to preview it here.'
                  : 'No resume uploaded yet.'}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {!loading && !member && !error ? (
        <div className="team-detail__status">
          Team member not found.{' '}
          <Link to="/dashboard/team">Return to Team</Link>
        </div>
      ) : null}
    </div>
  );
}

function getInitials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U'
  );
}

export default TeamMemberDetailPage;
