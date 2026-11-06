import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import { useAuth } from '../../context/AuthContext';
import {
  disconnectGmailConnection,
  fetchGmailConnections,
  startGmailConnect,
} from '../../lib/mailApi';
import { canManageMail, canReadMail } from '../../lib/roles';
import './SettingsPage.css';

/** Must match Google Cloud → Credentials → Authorized redirect URIs. */
export const GMAIL_OAUTH_REDIRECT_URI =
  'http://localhost:5173/api/gmail/oauth/callback';

function formatSyncTime(value) {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusLabel(row) {
  if (row.syncState === 'quota_paused') return 'Quota paused';
  if (row.syncState === 'sync_error' || row.status === 'error') {
    return 'Sync error';
  }
  if (row.status === 'connected' && row.connected && !row.lastError) {
    return 'Connected';
  }
  if (row.status === 'revoked') return 'Revoked';
  if (row.connected && row.lastError) return 'Sync error';
  return 'Not connected';
}

function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const canManage = canManageMail(profile?.user_role);
  const canViewConnections = canReadMail(profile?.user_role);

  const [connections, setConnections] = useState([]);
  const [syncQuery, setSyncQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const loadConnections = useCallback(async () => {
    if (!canViewConnections) {
      setLoading(false);
      setConnections([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchGmailConnections();
      setConnections(data.connections || []);
      setSyncQuery(data.syncQuery || '');
    } catch (err) {
      setError(err.message || 'Failed to load Gmail connections.');
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [canViewConnections]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const connected = searchParams.get('gmail_connected');
    const syncError = searchParams.get('gmail_sync_error');
    const gmailError = searchParams.get('gmail_error');
    if (connected) {
      if (syncError) {
        setStatus('Gmail authorized and verified.');
        setError(
          `Initial sync did not complete: ${decodeURIComponent(syncError)}`,
        );
      } else {
        setStatus(
          'Gmail authorized and verified. Initial interview mail sync finished.',
        );
      }
      navigate('/dashboard/settings', { replace: true });
      loadConnections();
      return;
    }
    if (gmailError) {
      setError(decodeURIComponent(gmailError));
      navigate('/dashboard/settings', { replace: true });
    }
  }, [searchParams, navigate, loadConnections]);

  async function handleConnect(teamMemberId) {
    if (!canManage) return;
    setBusyId(teamMemberId);
    setError('');
    setStatus('');
    try {
      const authUrl = await startGmailConnect(teamMemberId, {
        returnTo: '/dashboard/settings',
      });
      window.location.assign(authUrl);
    } catch (err) {
      setError(err.message || 'Failed to start Gmail authorization.');
      setBusyId('');
    }
  }

  async function handleDisconnect(row) {
    if (!canManage) return;
    if (
      !window.confirm(
        `Disconnect Gmail for ${row.name || row.email}? Synced mail for this member will be removed from Cal.ID.`,
      )
    ) {
      return;
    }
    setBusyId(row.teamMemberId);
    setError('');
    try {
      await disconnectGmailConnection(row.teamMemberId);
      setStatus(`Disconnected ${row.email || row.name}.`);
      await loadConnections();
    } catch (err) {
      setError(err.message || 'Failed to disconnect Gmail.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page__header">
        <div>
          <h1>Settings</h1>
          <p>Manage workspace preferences and Gmail authorizations.</p>
        </div>
        <UserMenu />
      </header>

      {error ? (
        <div className="settings-banner settings-banner--error">{error}</div>
      ) : null}
      {status ? (
        <div className="settings-banner settings-banner--status">{status}</div>
      ) : null}

      <section className="settings-card" aria-label="Gmail connections">
        <div className="settings-card__head">
          <div>
            <h2>Gmail Connections</h2>
            <p>
              {canManage
                ? 'Connect each team member’s personal Gmail with one-time Google consent (gmail.readonly). Cal.ID syncs interview mail directly — no inbox forwarding.'
                : 'View Gmail connection status for every team member. Only admins can connect or disconnect accounts.'}
            </p>
          </div>
          {canViewConnections ? (
            <Link to="/dashboard/mail" className="settings-link">
              Open Mail
            </Link>
          ) : null}
        </div>

        {!canViewConnections ? (
          <p className="settings-muted">
            Gmail connection status is available to admins and team members.
          </p>
        ) : loading ? (
          <p className="settings-muted">Loading connections…</p>
        ) : !connections.length ? (
          <p className="settings-muted">
            {canManage
              ? 'Add team members on the Team page, then connect their Gmail here.'
              : 'No team members yet. Ask an admin to add team members and connect Gmail.'}
          </p>
        ) : (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Gmail address</th>
                  <th>Status</th>
                  <th>Last sync</th>
                  {canManage ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {connections.map((row) => {
                  const busy = busyId === row.teamMemberId;
                  const hasConnection =
                    row.connected ||
                    row.status === 'connected' ||
                    row.status === 'error';
                  const syncOk =
                    hasConnection && !row.lastError && row.status === 'connected';
                  const syncBad = hasConnection && Boolean(row.lastError);
                  return (
                    <tr key={row.teamMemberId}>
                      <td>
                        <strong>{row.name || '—'}</strong>
                        {row.lastError ? (
                          <div className="settings-sub settings-sub--error">
                            {row.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {row.gmailAddress || row.email || '—'}
                        {row.gmailAddress &&
                        row.email &&
                        row.gmailAddress !== row.email.toLowerCase() ? (
                          <div className="settings-sub">
                            Team email: {row.email}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`settings-pill${
                            syncOk
                              ? ' is-ok'
                              : syncBad
                                ? ' is-error'
                                : ''
                          }`}
                        >
                          {statusLabel(row)}
                        </span>
                      </td>
                      <td>{formatSyncTime(row.lastSyncAt)}</td>
                      {canManage ? (
                        <td>
                          <div className="settings-actions">
                            {hasConnection ? (
                              <>
                                <button
                                  type="button"
                                  className="settings-btn"
                                  disabled={busy || !row.email}
                                  onClick={() =>
                                    handleConnect(row.teamMemberId)
                                  }
                                >
                                  {busy ? 'Redirecting…' : 'Reconnect'}
                                </button>
                                <button
                                  type="button"
                                  className="settings-btn settings-btn--danger"
                                  disabled={busy}
                                  onClick={() => handleDisconnect(row)}
                                >
                                  {busy ? 'Working…' : 'Disconnect'}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="settings-btn settings-btn--primary"
                                disabled={busy || !row.email}
                                onClick={() => handleConnect(row.teamMemberId)}
                              >
                                {busy ? 'Redirecting…' : 'Connect Gmail'}
                              </button>
                            )}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canManage ? (
          <div className="settings-setup">
            <h3>Google Cloud redirect URI</h3>
            <p>
              Register this <strong>exact</strong> URI on the InterviewManagement
              OAuth client (Authorized redirect URIs):
            </p>
            <code className="settings-setup__uri">{GMAIL_OAUTH_REDIRECT_URI}</code>
            <p className="settings-muted">
              Also add Authorized JavaScript origin:{' '}
              <code>http://localhost:5173</code>. Use <code>localhost</code>, not{' '}
              <code>127.0.0.1</code>.
            </p>
          </div>
        ) : null}

        {syncQuery ? (
          <details className="settings-query">
            <summary>Interview mail search query</summary>
            <code>{syncQuery}</code>
          </details>
        ) : null}

        {canViewConnections ? (
          <p className="settings-muted">
            {canManage ? (
              <>
                After accounts show <strong>Connected</strong>, open{' '}
                <Link to="/dashboard/mail">Mail</Link> to view all mailboxes or
                filter by team member. Use <strong>Full sync</strong> to refresh
                the last 7 days.
              </>
            ) : (
              <>
                Open <Link to="/dashboard/mail">Mail</Link> to browse interview
                email. Connection and sync actions are admin-only.
              </>
            )}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export default SettingsPage;
