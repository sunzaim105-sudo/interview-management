import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROLE_HOME } from '../../lib/roles';
import './AuthForm.css';

function resolveReturnPath(from, fallback) {
  if (!from) return fallback;
  if (typeof from === 'string' && from.startsWith('/')) return from;
  const pathname = from.pathname || '';
  if (!pathname.startsWith('/')) return fallback;
  return `${pathname}${from.search || ''}${from.hash || ''}`;
}

function SignInPage() {
  const { signIn, isAuthenticated, profile, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const returnTo = resolveReturnPath(
    location.state?.from,
    ROLE_HOME[profile?.user_role] || '/dashboard',
  );

  if (!loading && isAuthenticated && profile) {
    return <Navigate to={returnTo} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const result = await signIn({ userId, password });
      navigate(
        resolveReturnPath(location.state?.from, result.redirectTo),
        { replace: true },
      );
    } catch (err) {
      setError(err.message || 'Failed to sign in.');
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

          <div className="auth-field">
            <label htmlFor="signin-userid">
              User ID <span className="req">*</span>
            </label>
            <input
              id="signin-userid"
              type="text"
              placeholder="Enter your user ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div className="auth-field">
            <label htmlFor="signin-password">
              Password <span className="req">*</span>
            </label>
            <div className="auth-password">
              <input
                id="signin-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
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

          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="auth-footer">
          Don&apos;t have an account? <Link to="/signup">Sign up</Link>
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

export default SignInPage;
