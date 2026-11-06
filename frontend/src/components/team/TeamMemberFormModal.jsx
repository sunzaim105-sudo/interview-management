import { useEffect, useState } from 'react';
import { parseResumeFile } from '../../lib/resumeParseApi';
import './TeamModals.css';

const EMPTY = {
  name: '',
  professional_title: '',
  email: '',
  phone_number: '',
  location: '',
};

function TeamMemberFormModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState(EMPTY);
  const [resumeFile, setResumeFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [importNote, setImportNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setResumeFile(null);
    setError('');
    setImportNote('');
    setSubmitting(false);
    setParsing(false);
  }, [open]);

  if (!open) return null;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleResumeSelected(file) {
    setResumeFile(file || null);
    setError('');
    setImportNote('');
    if (!file) return;

    setParsing(true);
    try {
      const data = await parseResumeFile(file);
      setForm((current) => ({
        name: data.name || current.name,
        professional_title: data.professional_title || current.professional_title,
        email: data.email || current.email,
        phone_number: data.phone_number || current.phone_number,
        location: data.location || current.location,
      }));
      setImportNote(
        'Filled available fields from the resume. Review and edit before saving.',
      );
    } catch (err) {
      setError(err.message || 'Could not import fields from that resume.');
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        member: {
          name: form.name.trim(),
          professional_title: form.professional_title.trim(),
          email: form.email.trim(),
          phone_number: form.phone_number.trim(),
          location: form.location.trim(),
          resume_file: '',
        },
        resumeFile,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save team member.');
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || parsing;

  return (
    <div className="team-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="team-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-member-form-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="team-member-form-title">Add team member</h2>
        <p className="team-modal__hint">
          Enter details manually, or import a resume to autofill the form.
        </p>

        <form className="team-form" onSubmit={handleSubmit}>
          {error ? <div className="team-error">{error}</div> : null}
          {importNote ? <div className="team-success">{importNote}</div> : null}

          <div className="team-form__grid">
            <div className="team-field team-field--full">
              <span>Resume</span>
              <div className="team-file">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(e) =>
                    handleResumeSelected(e.target.files?.[0] || null)
                  }
                  disabled={busy}
                />
                <small>
                  PDF, DOCX, or TXT up to 10MB. Import fills name, title, email,
                  phone, and location when found. You can still edit everything
                  manually.
                </small>
                {resumeFile ? (
                  <small className="team-file__selected">
                    Selected: {resumeFile.name}
                    {parsing ? ' — importing…' : ''}
                  </small>
                ) : null}
              </div>
            </div>

            <label className="team-field">
              <span>Name *</span>
              <input
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Professional title</span>
              <input
                value={form.professional_title}
                onChange={(e) => updateField('professional_title', e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Email *</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Phone number</span>
              <input
                value={form.phone_number}
                onChange={(e) => updateField('phone_number', e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Location</span>
              <input
                value={form.location}
                onChange={(e) => updateField('location', e.target.value)}
                disabled={busy}
              />
            </label>
          </div>

          <div className="team-actions">
            <button
              type="button"
              className="team-btn-ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="team-btn-primary" disabled={busy}>
              {submitting ? 'Saving...' : parsing ? 'Importing...' : 'Add member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TeamMemberFormModal;
