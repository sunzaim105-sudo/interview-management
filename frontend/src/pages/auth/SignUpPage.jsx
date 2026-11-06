import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLE_HOME } from '../../lib/roles';
import './AuthForm.css';

function SignUpPage() {
  const { signUp, isAuthenticated, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!loading && isAuthenticated && profile) {
    return <Navigate to={ROLE_HOME[profile.user_role] || '/'} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!agreed) {
      setError('Please agree to the Terms and Conditions & Privacy Policy.');
      return;
    }

    const loginId = userId.trim();
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(loginId)) {
      setError(
        'User ID must be 3–64 characters and use only letters, numbers, dots, underscores, or hyphens.',
      );
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUp({
        email,
        username,
        userId: loginId,
        password,
      });
      setSuccess(result.message);
      setEmail('');
      setUsername('');
      setUserId('');
      setPassword('');
      setAgreed(false);
    } catch (err) {
      setError(err.message || 'Failed to create account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          Cal <span>ID</span>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error ? <div className="auth-alert auth-alert--error">{error}</div> : null}
          {success ? (
            <div className="auth-alert auth-alert--success">{success}</div>
          ) : null}

          <div className="auth-field">
            <label htmlFor="signup-email">
              Enter your email <span className="req">*</span>
            </label>
            <input
              id="signup-email"
              type="email"
              placeholder="eg. company@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="signup-username">
              User Name <span className="req">*</span>
            </label>
            <input
              id="signup-username"
              type="text"
              placeholder="eg. Jane Doe"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="nickname"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="signup-user-id">
              User ID <span className="req">*</span>
            </label>
            <input
              id="signup-user-id"
              type="text"
              placeholder="eg. Jane_Doe_1001"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoComplete="username"
              spellCheck={false}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="signup-password">
              Password <span className="req">*</span>
            </label>
            <div className="auth-password">
              <input
                id="signup-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-password__toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          <label className="auth-check">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I agree to the provisions of the{' '}
              <a href="#terms">Terms and Conditions</a> &{' '}
              <a href="#privacy">Privacy Policy</a>{' '}
              <span className="req">*</span>
            </span>
          </label>

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/signin">Log in</Link>
        </p>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6A3 3 0 0012 15a3 3 0 002.4-4.4M9.9 5.1A11 11 0 0112 5c6.5 0 10 7 10 7a18 18 0 01-4.2 4.8M6.1 6.1A18 18 0 002 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default SignUpPage;
