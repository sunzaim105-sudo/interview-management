import { useEffect, useState } from 'react';
import {
  PERMISSION_OPTIONS,
  ROLE_OPTIONS,
  ROLES,
  USER_STATUS,
} from '../../lib/roles';
import './UserFormModal.css';

function UserFormModal({ open, onClose, onSubmit }) {
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(ROLES.CALLER);
  const [status, setStatus] = useState(USER_STATUS.ALLOWED);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setUserId('');
    setEmail('');
    setPassword('');
    setRole(ROLES.CALLER);
    setStatus(USER_STATUS.ALLOWED);
    setError('');
    setSubmitting(false);
  }, [open]);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!username.trim() || !userId.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        username: username.trim(),
        user_id: userId.trim(),
        email: email.trim().toLowerCase(),
        password,
        user_role: role,
        status,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="user-modal-backdrop" onClick={onClose}>
      <div
        className="user-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="user-modal__head">
          <h2 id="user-form-title">Add user</h2>
          <button type="button" className="user-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="user-modal__form" onSubmit={handleSubmit}>
          {error ? <div className="user-modal__error">{error}</div> : null}

          <label>
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label>
            <span>User ID</span>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Login ID"
              required
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>

          <div className="user-modal__row">
            <label>
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Permission</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {PERMISSION_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="user-modal__actions">
            <button type="button" className="user-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="user-btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default UserFormModal;
