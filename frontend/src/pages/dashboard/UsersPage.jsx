import { useCallback, useEffect, useMemo, useState } from 'react';
import UserMenu from '../../components/dashboard/UserMenu';
import UserFormModal from '../../components/users/UserFormModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { ensureCallerProfile } from '../../lib/callersApi';
import {
  PERMISSION_OPTIONS,
  ROLE_OPTIONS,
  ROLES,
  formatPermissionLabel,
  formatRoleLabel,
} from '../../lib/roles';
import {
  createUserAccount,
  deleteUserAccount,
  fetchUsers,
  updateUser,
} from '../../lib/usersApi';
import './UsersPage.css';

function UsersPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ user_role: '', status: '' });
  const [pendingUpdate, setPendingUpdate] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const userRows = await fetchUsers();
      setUsers(userRows);
      setSelectedIds([]);
      setEditingId('');
      setPendingUpdate(null);
    } catch (err) {
      setError(err.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allSelected = useMemo(
    () => users.length > 0 && selectedIds.length === users.length,
    [users, selectedIds],
  );

  const deleteMessage = useMemo(() => {
    const count = selectedIds.length;
    return `Delete ${count} user${count === 1 ? '' : 's'}? This removes their login and cannot be undone.`;
  }, [selectedIds.length]);

  const updateMessage = useMemo(() => {
    if (!pendingUpdate) return '';
    const roleChanged =
      pendingUpdate.user_role !== pendingUpdate.original.user_role;
    const statusChanged = pendingUpdate.status !== pendingUpdate.original.status;
    const parts = [];
    if (roleChanged) {
      parts.push(
        `role from ${formatRoleLabel(pendingUpdate.original.user_role)} to ${formatRoleLabel(pendingUpdate.user_role)}`,
      );
    }
    if (statusChanged) {
      parts.push(
        `permission from ${formatPermissionLabel(pendingUpdate.original.status)} to ${formatPermissionLabel(pendingUpdate.status)}`,
      );
    }
    return `Update ${pendingUpdate.username}'s ${parts.join(' and ')}?`;
  }, [pendingUpdate]);

  function toggleUser(id) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : users.map((user) => user.id));
  }

  function startEdit(user) {
    if (user.id === profile?.id) return;
    setEditingId(user.id);
    setDraft({
      user_role: user.user_role,
      status: user.status,
    });
    setError('');
  }

  function cancelEdit() {
    setEditingId('');
    setDraft({ user_role: '', status: '' });
    setPendingUpdate(null);
    setUpdateOpen(false);
  }

  function requestSave(user) {
    if (!editingId || editingId !== user.id) return;
    const nextRole = draft.user_role;
    const nextStatus = draft.status;
    const unchanged =
      nextRole === user.user_role && nextStatus === user.status;
    if (unchanged) {
      cancelEdit();
      return;
    }
    setPendingUpdate({
      id: user.id,
      username: user.username,
      user_role: nextRole,
      status: nextStatus,
      original: {
        user_role: user.user_role,
        status: user.status,
      },
    });
    setUpdateOpen(true);
  }

  async function handleCreate(payload) {
    await createUserAccount(payload);
    await loadData();
  }

  async function confirmUpdate() {
    if (!pendingUpdate) return;
    setBusy(true);
    setSavingId(pendingUpdate.id);
    setError('');
    try {
      const payload = {
        user_role: pendingUpdate.user_role,
        status: pendingUpdate.status,
      };
      const updated = await updateUser(pendingUpdate.id, payload);
      setUsers((current) =>
        current.map((user) => (user.id === pendingUpdate.id ? updated : user)),
      );
      if (
        payload.user_role === ROLES.CALLER ||
        updated.user_role === ROLES.CALLER
      ) {
        await ensureCallerProfile(updated);
      }
      setUpdateOpen(false);
      setPendingUpdate(null);
      setEditingId('');
      setDraft({ user_role: '', status: '' });
    } catch (err) {
      setError(err.message || 'Failed to update user.');
      setUpdateOpen(false);
    } finally {
      setBusy(false);
      setSavingId('');
    }
  }

  async function confirmDelete() {
    if (!selectedIds.length) return;
    setBusy(true);
    setError('');
    try {
      for (const id of selectedIds) {
        if (id === profile?.id) {
          throw new Error('You cannot delete your own account.');
        }
        await deleteUserAccount(id);
      }
      setDeleteOpen(false);
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to delete users.');
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="users-page">
      <header className="users-page__header">
        <div>
          <h1>Users</h1>
          <p>Manage roles and permissions.</p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="users-page__error">{error}</div> : null}
      {loading ? <div className="users-page__status">Loading...</div> : null}

      {!loading ? (
        <section className="users-panel" aria-label="Users">
          <div className="users-panel__toolbar">
            <div>
              <h2>All users</h2>
              <p>
                {users.length} user{users.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="users-panel__actions">
              <button
                type="button"
                className="users-btn-danger"
                disabled={!selectedIds.length || busy}
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </button>
              <button
                type="button"
                className="users-btn-primary"
                onClick={() => setFormOpen(true)}
              >
                + Add
              </button>
            </div>
          </div>

          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-table__check">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all users"
                    />
                  </th>
                  <th>Username</th>
                  <th>User ID</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Permission</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="users-table__empty">
                      No users yet.
                    </td>
                  </tr>
                ) : null}
                {users.map((user) => {
                  const selected = selectedIds.includes(user.id);
                  const isSelf = user.id === profile?.id;
                  const isEditing = editingId === user.id;
                  const busyRow = savingId === user.id;
                  return (
                    <tr key={user.id} className={selected ? 'is-selected' : ''}>
                      <td className="users-table__check">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleUser(user.id)}
                          aria-label={`Select ${user.username}`}
                          disabled={isEditing}
                        />
                      </td>
                      <td>
                        <strong
                          className={`users-table__name users-table__name--${user.user_role}`}
                        >
                          {user.username}
                        </strong>
                        {isSelf ? (
                          <span className="users-table__you">You</span>
                        ) : null}
                      </td>
                      <td>{user.user_id}</td>
                      <td>{user.email}</td>
                      <td>
                        {isEditing ? (
                          <select
                            className="users-inline-select"
                            value={draft.user_role}
                            disabled={busyRow}
                            onChange={(e) =>
                              setDraft((current) => ({
                                ...current,
                                user_role: e.target.value,
                              }))
                            }
                            aria-label={`Role for ${user.username}`}
                          >
                            {ROLE_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="users-table__value">
                            {formatRoleLabel(user.user_role)}
                          </span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <select
                            className={`users-inline-select users-inline-select--status is-${draft.status}`}
                            value={draft.status}
                            disabled={busyRow}
                            onChange={(e) =>
                              setDraft((current) => ({
                                ...current,
                                status: e.target.value,
                              }))
                            }
                            aria-label={`Permission for ${user.username}`}
                          >
                            {PERMISSION_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`users-table__value users-table__value--status is-${user.status}`}
                          >
                            {formatPermissionLabel(user.status)}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="users-row-actions">
                          {isSelf ? (
                            <span className="users-table__muted">—</span>
                          ) : isEditing ? (
                            <>
                              <button
                                type="button"
                                className="users-btn-primary users-btn-primary--small"
                                disabled={busyRow || busy}
                                onClick={() => requestSave(user)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="users-btn-ghost"
                                disabled={busyRow || busy}
                                onClick={cancelEdit}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="users-btn-ghost"
                              disabled={Boolean(editingId) || busy}
                              onClick={() => startEdit(user)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <UserFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete users"
        message={deleteMessage}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={updateOpen}
        title="Update user"
        message={updateMessage}
        confirmLabel="Save changes"
        cancelLabel="Cancel"
        danger={false}
        busy={busy}
        onCancel={() => {
          if (busy) return;
          setUpdateOpen(false);
          setPendingUpdate(null);
        }}
        onConfirm={confirmUpdate}
      />
    </div>
  );
}

export default UsersPage;
