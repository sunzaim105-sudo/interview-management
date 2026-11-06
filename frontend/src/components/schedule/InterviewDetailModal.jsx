import { useNavigate } from 'react-router-dom';
import { formatDisplayDate, formatTimeBySetting } from '../../lib/calendarSettings';
import { DEFAULT_INTERVIEW_STAGE } from '../../lib/interviewStages';
import './InterviewModals.css';

function InterviewDetailModal({
  interview,
  settings,
  isAdmin = false,
  onClose,
  onEdit,
  onCancelBooking,
}) {
  const navigate = useNavigate();

  if (!interview) return null;

  const start = new Date(interview.start_time);
  const end = new Date(interview.end_time);

  function goToJob() {
    if (!interview.job?.id) return;
    onClose();
    navigate(`/dashboard/jobs/${interview.job.id}`);
  }

  function goToMember() {
    if (!interview.invited_member?.id) return;
    onClose();
    navigate(`/dashboard/team/members/${interview.invited_member.id}`);
  }

  return (
    <div className="interview-modal-backdrop" onClick={onClose}>
      <div
        className="interview-modal interview-modal--detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="interview-detail__head">
          <div>
            <p className="interview-detail__eyebrow">Interview details</p>
            <h2 id="interview-detail-title">{interview.interview_name}</h2>
          </div>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <dl className="interview-detail__list">
          <div>
            <dt>Caller</dt>
            <dd>
              {interview.caller?.profile?.name ||
                interview.caller?.username ||
                'Unknown'}
              {interview.caller?.user_id ? (
                <span className="interview-detail__meta">
                  {interview.caller.user_id}
                </span>
              ) : null}
              {interview.caller?.profile?.email || interview.caller?.email ? (
                <span className="interview-detail__meta">
                  {interview.caller?.profile?.email || interview.caller?.email}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Invited member</dt>
            <dd>
              {interview.invited_member?.id ? (
                <button type="button" className="interview-detail__link" onClick={goToMember}>
                  {interview.invited_member?.name || 'Unknown'}
                </button>
              ) : (
                interview.invited_member?.name || 'Unknown'
              )}
            </dd>
          </div>
          <div>
            <dt>Job title</dt>
            <dd>
              {interview.job?.id ? (
                <button type="button" className="interview-detail__link" onClick={goToJob}>
                  {interview.job?.job_title || 'Unknown'}
                </button>
              ) : (
                interview.job?.job_title || 'Unknown'
              )}
            </dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{interview.job?.company_name || '—'}</dd>
          </div>
          <div>
            <dt>Meeting link</dt>
            <dd>
              {interview.meeting_link ? (
                <a
                  href={interview.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="interview-detail__link"
                >
                  {interview.meeting_link}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              <span className="interview-detail__when">
                {formatDisplayDate(start, settings.dateFormat, settings.timeZone)}
              </span>
              <span className="interview-detail__meta">
                {formatTimeBySetting(start, settings.timeFormat, settings.timeZone)}
                {' – '}
                {formatTimeBySetting(end, settings.timeFormat, settings.timeZone)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Reminder</dt>
            <dd>
              {settings.notificationLeadMinutes
                ? `${settings.notificationLeadMinutes} min before`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>
              <span className="interview-detail__stage">
                {interview.stage && interview.stage !== 'Onboarding'
                  ? interview.stage
                  : DEFAULT_INTERVIEW_STAGE}
              </span>
            </dd>
          </div>
          {interview.booking_note ? (
            <div>
              <dt>Note</dt>
              <dd className="interview-detail__note">{interview.booking_note}</dd>
            </div>
          ) : null}
        </dl>

        <div className={`interview-actions${isAdmin ? ' interview-actions--split' : ''}`}>
          {isAdmin ? (
            <>
              <button type="button" className="btn-outline-pill" onClick={onEdit}>
                <EditIcon />
                Edit
              </button>
              <button
                type="button"
                className="btn-outline-pill btn-outline-pill--danger"
                onClick={onCancelBooking}
              >
                <TrashIcon />
                Cancel Booking
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 12a7.5 7.5 0 0 1 12.4-5.7M19.5 12A7.5 7.5 0 0 1 7.1 17.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.5 4.8V7.5H19.2M7.5 19.2v-2.7H4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default InterviewDetailModal;
