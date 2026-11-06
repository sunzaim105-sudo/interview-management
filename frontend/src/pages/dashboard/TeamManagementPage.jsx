import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import TeamMemberFormModal from '../../components/team/TeamMemberFormModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { canEditWorkspace, isTeamMemberRole } from '../../lib/roles';
import {
  createTeamMember,
  deleteTeamMembers,
  fetchTeamMembers,
  uploadResume,
} from '../../lib/teamApi';
import './TeamManagementPage.css';

function TeamManagementPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = canEditWorkspace(profile?.user_role);
  const isTeamMember = isTeamMemberRole(profile?.user_role);
  const [members, setMembers] = useState([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const memberRows = await fetchTeamMembers();
      setMembers(memberRows);
      setSelectedMemberIds([]);
    } catch (err) {
      setError(err.message || 'Failed to load team data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allMembersSelected = useMemo(
    () => members.length > 0 && selectedMemberIds.length === members.length,
    [members, selectedMemberIds],
  );

  const deleteMessage = useMemo(() => {
    const count = selectedMemberIds.length;
    return `Delete ${count} team member${count === 1 ? '' : 's'}? This cannot be undone.`;
  }, [selectedMemberIds.length]);

  function toggleMember(id) {
    setSelectedMemberIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleAllMembers() {
    setSelectedMemberIds(allMembersSelected ? [] : members.map((member) => member.id));
  }

  async function handleCreateMember({ member, resumeFile }) {
    const created = await createTeamMember(member);
    if (resumeFile) {
      await uploadResume(created.id, resumeFile);
    }
    await loadData();
  }

  async function confirmDeleteMembers() {
    if (!selectedMemberIds.length) return;

    setBusy(true);
    setError('');
    try {
      await deleteTeamMembers(selectedMemberIds);
      setConfirmOpen(false);
      await loadData();
    } catch (err) {
      setError(
        err.message?.includes('foreign key')
          ? 'Cannot delete a team member who is linked to interviews.'
          : err.message || 'Failed to delete team members.',
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
          <h1>Team</h1>
          <p>
            {isTeamMember
              ? 'View team members and resumes (read-only).'
              : 'Manage invited team members and resumes.'}
          </p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="team-page__error">{error}</div> : null}
      {loading ? <div className="team-page__status">Loading...</div> : null}

      {!loading ? (
        <section className="team-panel" aria-label="Team members">
          <div className="team-panel__toolbar">
            <div>
              <h2>Team members</h2>
              <p>
                {members.length} member{members.length === 1 ? '' : 's'}
              </p>
            </div>
            {canEdit ? (
              <div className="team-panel__actions">
                <button
                  type="button"
                  className="team-btn-danger"
                  disabled={!selectedMemberIds.length || busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="team-btn-primary"
                  onClick={() => setMemberFormOpen(true)}
                >
                  + Add
                </button>
              </div>
            ) : (
              <p className="team-panel__readonly">Read-only</p>
            )}
          </div>

          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  {canEdit ? (
                    <th className="team-table__check">
                      <input
                        type="checkbox"
                        checked={allMembersSelected}
                        onChange={toggleAllMembers}
                        aria-label="Select all team members"
                      />
                    </th>
                  ) : null}
                  <th>Name</th>
                  <th>Title</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Location</th>
                  <th>Resume</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 7 : 6} className="team-table__empty">
                      {canEdit
                        ? 'No team members yet. Click Add to create one.'
                        : 'No team members available for your account.'}
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr
                      key={member.id}
                      className="team-table__row"
                      onClick={() => navigate(`/dashboard/team/members/${member.id}`)}
                    >
                      {canEdit ? (
                        <td
                          className="team-table__check"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.includes(member.id)}
                            onChange={() => toggleMember(member.id)}
                            aria-label={`Select ${member.name}`}
                          />
                        </td>
                      ) : null}
                      <td>
                        <strong>{member.name}</strong>
                      </td>
                      <td>{member.professional_title || '—'}</td>
                      <td>{member.email}</td>
                      <td>{member.phone_number || '—'}</td>
                      <td>{member.location || '—'}</td>
                      <td>
                        <span
                          className={`team-badge${member.resume_file ? ' is-ready' : ''}`}
                        >
                          {member.resume_file ? 'Uploaded' : 'Missing'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <>
          <TeamMemberFormModal
            open={memberFormOpen}
            onClose={() => setMemberFormOpen(false)}
            onSubmit={handleCreateMember}
          />

          <ConfirmDialog
            open={confirmOpen}
            title="Delete team members"
            message={deleteMessage}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            busy={busy}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={confirmDeleteMembers}
          />
        </>
      ) : null}
    </div>
  );
}

export default TeamManagementPage;
