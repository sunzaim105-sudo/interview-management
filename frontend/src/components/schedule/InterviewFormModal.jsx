import { useEffect, useMemo, useState } from 'react';
import {
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '../../lib/calendarSettings';
import {
  DEFAULT_INTERVIEW_STAGE,
  INTERVIEW_STAGES,
} from '../../lib/interviewStages';
import './InterviewModals.css';

function buildTimeSuggestions(stepMinutes = 30) {
  const options = [];
  for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
    const hour = Math.floor(mins / 60);
    const minute = mins % 60;
    options.push(
      `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    );
  }
  return options;
}

const TIME_SUGGESTIONS = buildTimeSuggestions(30);

function normalizeTimeValue(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function InterviewFormModal({
  open,
  mode = 'create',
  interview = null,
  callers,
  teamMembers,
  jobs,
  settings,
  initialDate,
  initialStartHour = 9,
  initialStartMinute = 0,
  onClose,
  onSubmit,
}) {
  const isEdit = mode === 'edit';
  const timeZone = settings?.timeZone || 'UTC';
  const [interviewName, setInterviewName] = useState('');
  const [callerId, setCallerId] = useState('');
  const [invitedMemberId, setInvitedMemberId] = useState('');
  const [jobId, setJobId] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [bookingNote, setBookingNote] = useState('');
  const [stage, setStage] = useState(DEFAULT_INTERVIEW_STAGE);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;

    if (isEdit && interview) {
      const start = new Date(interview.start_time);
      const end = new Date(interview.end_time);
      const startWall = utcToZonedWallTime(start, timeZone);
      const endWall = utcToZonedWallTime(end, timeZone);
      setInterviewName(interview.interview_name || '');
      setCallerId(interview.caller_id || '');
      setInvitedMemberId(interview.invited_member_id || '');
      setJobId(interview.job_id || '');
      setMeetingLink(interview.meeting_link || '');
      setBookingNote(interview.booking_note || '');
      const nextStage = interview.stage || DEFAULT_INTERVIEW_STAGE;
      setStage(
        INTERVIEW_STAGES.includes(nextStage)
          ? nextStage
          : DEFAULT_INTERVIEW_STAGE,
      );
      setDate(startWall.date);
      setStartTime(startWall.time);
      setEndTime(endWall.time);
    } else {
      const seed = initialDate ? new Date(initialDate) : new Date();
      seed.setHours(initialStartHour, initialStartMinute, 0, 0);
      const startWall = utcToZonedWallTime(seed, timeZone);
      const endSeed = new Date(seed.getTime() + 30 * 60 * 1000);
      const endWall = utcToZonedWallTime(endSeed, timeZone);
      setInterviewName('');
      setCallerId(callers[0]?.id || '');
      setInvitedMemberId(teamMembers[0]?.id || '');
      setJobId(jobs[0]?.id || '');
      setMeetingLink('');
      setBookingNote('');
      setStage(DEFAULT_INTERVIEW_STAGE);
      setDate(startWall.date);
      setStartTime(startWall.time);
      setEndTime(endWall.time);
    }

    setError('');
    setSubmitting(false);
  }, [
    open,
    isEdit,
    interview,
    callers,
    teamMembers,
    jobs,
    initialDate,
    initialStartHour,
    initialStartMinute,
    timeZone,
  ]);

  const durationLabel = useMemo(() => {
    const start = normalizeTimeValue(startTime);
    const end = normalizeTimeValue(endTime);
    if (!start || !end) return 'Enter start and end times';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) return 'Invalid range';
    if (mins < 60) return `Duration: ${mins} mins`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `Duration: ${hours}h ${rem}m` : `Duration: ${hours}h`;
  }, [startTime, endTime]);

  const selectedJob = jobs.find((job) => job.id === jobId);
  const selectedCaller = callers.find((caller) => caller.id === callerId);

  if (!open) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!interviewName.trim() || !callerId || !invitedMemberId || !jobId) {
      setError('Please fill in all required fields.');
      return;
    }

    if (!meetingLink.trim()) {
      setError('Meeting link is required.');
      return;
    }

    const normalizedStart = normalizeTimeValue(startTime);
    const normalizedEnd = normalizeTimeValue(endTime);
    if (!date || !normalizedStart || !normalizedEnd) {
      setError('Enter a valid date, start time, and end time.');
      return;
    }

    const start = zonedWallTimeToUtc(date, normalizedStart, timeZone);
    const end = zonedWallTimeToUtc(date, normalizedEnd, timeZone);
    if (!(end > start)) {
      setError('End time must be after start time.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        interview_name: interviewName.trim(),
        caller_id: callerId,
        invited_member_id: invitedMemberId,
        job_id: jobId,
        meeting_link: meetingLink.trim(),
        booking_note: bookingNote.trim(),
        stage,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      });
      onClose();
    } catch (err) {
      setError(err.message || `Failed to ${isEdit ? 'update' : 'create'} interview.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="interview-modal-backdrop" onClick={onClose}>
      <div
        className="interview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="interview-modal__head">
          <h2 id="interview-form-title">{isEdit ? 'Edit' : 'New Interview'}</h2>
          <button
            type="button"
            className="icon-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="interview-form" onSubmit={handleSubmit}>
          {error ? <div className="interview-alert">{error}</div> : null}

          <label className="interview-field">
            <span>{isEdit ? 'Event title' : 'Interview name'} *</span>
            <input
              value={interviewName}
              onChange={(e) => setInterviewName(e.target.value)}
              placeholder="Interview title"
              required
            />
          </label>

          <label className="interview-field">
            <span>Caller *</span>
            <select value={callerId} onChange={(e) => setCallerId(e.target.value)} required>
              <option value="" disabled>
                Select a caller
              </option>
              {callers.map((caller) => (
                <option key={caller.id} value={caller.id}>
                  {caller.name || caller.username}
                  {caller.user_id ? ` (${caller.user_id})` : ''}
                </option>
              ))}
            </select>
            {selectedCaller ? (
              <small>
                {[selectedCaller.email, selectedCaller.location]
                  .filter(Boolean)
                  .join(' · ') || selectedCaller.user_id}
              </small>
            ) : null}
          </label>

          <label className="interview-field">
            <span>Invited member *</span>
            <select
              value={invitedMemberId}
              onChange={(e) => setInvitedMemberId(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a team member
              </option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="interview-field">
            <span>Job title *</span>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} required>
              <option value="" disabled>
                Select a job
              </option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.job_title} — {job.company_name}
                </option>
              ))}
            </select>
            {selectedJob ? <small>{selectedJob.company_name}</small> : null}
          </label>

          <label className="interview-field">
            <span>Meeting link *</span>
            <input
              type="url"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              placeholder="https://meet.google.com/..."
              required
            />
          </label>

          <label className="interview-field">
            <span>Date *</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            <small>Times use {timeZone.replace(/_/g, ' ')}</small>
          </label>

          <div className="interview-time-row">
            <label className="interview-field">
              <span>Start time *</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                list="interview-time-suggestions"
                step="1800"
                required
              />
              <small>{durationLabel}</small>
            </label>

            <label className="interview-field">
              <span>End time *</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                list="interview-time-suggestions"
                step="1800"
                required
              />
            </label>
          </div>

          <datalist id="interview-time-suggestions">
            {TIME_SUGGESTIONS.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>

          <label className="interview-field">
            <span>Stage *</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} required>
              {INTERVIEW_STAGES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="interview-field">
            <span>Booking note</span>
            <textarea
              value={bookingNote}
              onChange={(e) => setBookingNote(e.target.value)}
              placeholder="Add notes..."
              rows={3}
            />
          </label>

          <div className="interview-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                submitting || !callers.length || !teamMembers.length || !jobs.length
              }
            >
              {submitting
                ? isEdit
                  ? 'Saving...'
                  : 'Creating...'
                : isEdit
                  ? 'Save changes'
                  : 'Create Interview'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InterviewFormModal;
