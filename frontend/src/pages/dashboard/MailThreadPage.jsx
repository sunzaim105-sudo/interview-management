import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import UserMenu from '../../components/dashboard/UserMenu';
import { useAuth } from '../../context/AuthContext';
import {
  formatMailDateLong,
  senderEmail,
  senderInitials,
  senderLabel,
} from '../../lib/mailHelpers';
import {
  downloadMailAttachment,
  fetchInterviewsForLinking,
  fetchMailBootstrap,
  fetchMailThread,
  linkThreadInterview,
  markMailThreadSeen,
} from '../../lib/mailApi';
import { canManageMail } from '../../lib/roles';
import './MailPage.css';

function MailThreadPage() {
  const { threadId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isMailAdmin = canManageMail(profile?.user_role);
  const [accountId, setAccountId] = useState(
    searchParams.get('account') || sessionStorage.getItem('mail_account_id') || '',
  );
  const [detail, setDetail] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const loadThread = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError('');
    try {
      let activeAccountId = accountId;
      if (!activeAccountId) {
        const bootstrap = await fetchMailBootstrap();
        activeAccountId = bootstrap.accounts?.[0]?.id || '';
        if (activeAccountId) {
          setAccountId(activeAccountId);
          sessionStorage.setItem('mail_account_id', activeAccountId);
        }
      }
      if (!activeAccountId) {
        throw new Error(
          'Missing Gmail account for this conversation. Open it again from the Mail list.',
        );
      }

      const data = await fetchMailThread(activeAccountId, threadId);
      setDetail(data);
      if (
        isMailAdmin &&
        data?.messages?.some((m) => m.isUnread)
      ) {
        await markMailThreadSeen(activeAccountId, threadId);
      }
      if (isMailAdmin && !interviews.length) {
        const rows = await fetchInterviewsForLinking();
        setInterviews(rows);
      }
    } catch (err) {
      setError(err.message || 'Failed to open conversation.');
    } finally {
      setLoading(false);
    }
  }, [accountId, threadId, interviews.length, isMailAdmin]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  async function handleLinkInterview(interviewId) {
    if (!isMailAdmin || !accountId || !threadId) return;
    setBusy('link');
    try {
      await linkThreadInterview(accountId, threadId, interviewId || null);
      await loadThread();
      setStatus(
        interviewId ? 'Conversation linked to interview.' : 'Interview link cleared.',
      );
    } catch (err) {
      setError(err.message || 'Failed to link interview.');
    } finally {
      setBusy('');
    }
  }

  async function handleDownloadAttachment(message, attachment) {
    setBusy(`att-${attachment.attachmentId}`);
    setError('');
    try {
      await downloadMailAttachment(accountId, {
        messageId: message.gmailMessageId,
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      });
    } catch (err) {
      setError(err.message || 'Failed to download attachment.');
    } finally {
      setBusy('');
    }
  }

  const subject =
    detail?.messages?.[0]?.subject || detail?.subject || '(no subject)';

  return (
    <div className="gmail-app">
      <header className="gmail-topbar">
        <div className="gmail-topbar__brand">
          <span className="gmail-topbar__logo" aria-hidden="true">
            M
          </span>
          <div>
            <strong>Mail</strong>
            <em>Interview inbox</em>
          </div>
        </div>
        <div className="gmail-search gmail-search--static">
          <span>{subject}</span>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="gmail-banner gmail-banner--error">{error}</div> : null}
      {status ? <div className="gmail-banner gmail-banner--status">{status}</div> : null}

      <div className="gmail-thread-page">
        <div className="gmail-thread-toolbar">
          <button
            type="button"
            className="gmail-icon-btn"
            title="Back to Inbox"
            onClick={() => navigate('/dashboard/mail')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z" />
            </svg>
          </button>
          <Link to="/dashboard/mail" className="gmail-back-link">
            Back to Inbox
          </Link>
        </div>

        {loading ? (
          <div className="gmail-empty">Opening conversation…</div>
        ) : !detail ? (
          <div className="gmail-empty">Conversation not found.</div>
        ) : (
          <article className="gmail-thread">
            <header className="gmail-thread__subject">
              <h1>{subject}</h1>
              <span className="gmail-label">Inbox</span>
              {detail.matchedMember ? (
                <span className="gmail-label gmail-label--team">
                  {detail.matchedMember.name}
                </span>
              ) : null}
              {detail.interview ? (
                <span className="gmail-label gmail-label--team">
                  {detail.interview.interview_name}
                </span>
              ) : null}
            </header>

            {isMailAdmin ? (
              <label className="gmail-thread__link">
                <span>Interview</span>
                <select
                  value={detail.interviewId || ''}
                  onChange={(e) => handleLinkInterview(e.target.value)}
                  disabled={busy === 'link'}
                >
                  <option value="">Not linked</option>
                  {interviews.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.interview_name} ·{' '}
                      {item.invited_member?.name || 'Member'}
                    </option>
                  ))}
                </select>
              </label>
            ) : detail.interview ? (
              <p className="gmail-thread__link">
                <span>Interview</span>
                <strong>{detail.interview.interview_name}</strong>
              </p>
            ) : null}

            <div className="gmail-thread__messages">
              {detail.messages?.map((message) => (
                <section key={message.gmailMessageId} className="gmail-message">
                  <div
                    className="gmail-avatar"
                    aria-hidden="true"
                    data-initial={senderInitials(message.from)}
                  >
                    {senderInitials(message.from)}
                  </div>
                  <div className="gmail-message__main">
                    <header className="gmail-message__head">
                      <div>
                        <strong>{senderLabel(message.from)}</strong>
                        {senderEmail(message.from) ? (
                          <span>&lt;{senderEmail(message.from)}&gt;</span>
                        ) : null}
                        <em>to {message.to || 'me'}</em>
                      </div>
                      <time>{formatMailDateLong(message.internalDate)}</time>
                    </header>

                    {message.attachments?.length ? (
                      <ul className="gmail-attachments">
                        {message.attachments.map((attachment) => (
                          <li key={attachment.attachmentId}>
                            <button
                              type="button"
                              className="gmail-attachment"
                              disabled={
                                busy === `att-${attachment.attachmentId}`
                              }
                              onClick={() =>
                                handleDownloadAttachment(message, attachment)
                              }
                            >
                              {busy === `att-${attachment.attachmentId}`
                                ? 'Downloading…'
                                : attachment.filename || 'Attachment'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {message.bodyHtml ? (
                      <iframe
                        className="gmail-message__html-frame"
                        title={message.subject || 'Email message'}
                        sandbox=""
                        referrerPolicy="no-referrer"
                        srcDoc={`<!doctype html><html><head><meta charset="utf-8" /><base target="_blank" rel="noopener noreferrer" /><style>body{margin:0;font:14px/1.45 system-ui,sans-serif;color:#111;word-break:break-word;}img{max-width:100%;height:auto;}a{color:#1a73e8;}</style></head><body>${message.bodyHtml}</body></html>`}
                      />
                    ) : (
                      <pre className="gmail-message__text">
                        {message.bodyText || message.snippet}
                      </pre>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

export default MailThreadPage;
