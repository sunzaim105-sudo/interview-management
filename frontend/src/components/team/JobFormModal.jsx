import { useEffect, useState } from 'react';
import { scrapeJobLink } from '../../lib/jobScrapeApi';
import './TeamModals.css';

const EMPTY = {
  job_link: '',
  job_title: '',
  company_name: '',
  workplace_location: '',
  work_setup: '',
  salary: '',
  required_level: '',
  required_experience: '',
};

function JobFormModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState('');
  const [importNote, setImportNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setError('');
    setImportNote('');
    setSubmitting(false);
    setScraping(false);
  }, [open]);

  if (!open) return null;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleImportFromLink() {
    setError('');
    setImportNote('');

    if (!form.job_link.trim()) {
      setError('Paste a job link first.');
      return;
    }

    setScraping(true);
    try {
      const data = await scrapeJobLink(form.job_link.trim());
      setForm((current) => ({
        ...current,
        job_link: data.job_link || current.job_link.trim(),
        job_title: data.job_title || current.job_title,
        company_name: data.company_name || current.company_name,
        workplace_location: data.workplace_location || current.workplace_location,
        work_setup: data.work_setup || current.work_setup,
        salary: data.salary || current.salary,
        required_level: data.required_level || current.required_level,
        required_experience:
          data.required_experience || current.required_experience,
      }));
      setImportNote(
        'Imported title, company, location, setup, salary, level, and experience. Review before saving.',
      );
    } catch (err) {
      setError(err.message || 'Could not import from that job link.');
    } finally {
      setScraping(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!form.job_link.trim()) {
      setError('Job link is required.');
      return;
    }

    try {
      const parsed = new URL(form.job_link.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        setError('Job link must be an http or https URL.');
        return;
      }
    } catch {
      setError('Enter a valid job link URL.');
      return;
    }

    if (!form.job_title.trim() || !form.company_name.trim()) {
      setError('Job title and company are required.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        job_link: form.job_link.trim(),
        job_title: form.job_title.trim(),
        company_name: form.company_name.trim(),
        workplace_location: form.workplace_location.trim(),
        work_setup: form.work_setup.trim(),
        salary: form.salary.trim(),
        required_level: form.required_level.trim(),
        required_experience: form.required_experience.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save job.');
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || scraping;

  return (
    <div className="team-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="team-modal team-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-form-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="job-form-title">Add job</h2>
        <p className="team-modal__hint">
          Add a job manually, or paste a posting link and import key details.
        </p>

        <form className="team-form" onSubmit={handleSubmit}>
          {error ? <div className="team-error">{error}</div> : null}
          {importNote ? <div className="team-success">{importNote}</div> : null}

          <div className="team-form__grid">
            <label className="team-field team-field--full">
              <span>Job link *</span>
              <div className="team-field__row">
                <input
                  type="url"
                  value={form.job_link}
                  onChange={(e) => updateField('job_link', e.target.value)}
                  placeholder="https://..."
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  className="team-btn-secondary"
                  onClick={handleImportFromLink}
                  disabled={busy || !form.job_link.trim()}
                >
                  {scraping ? 'Importing...' : 'Import'}
                </button>
              </div>
              <small>
                Imports job title, company, workplace location, work setup,
                salary, required level, and required experience only.
              </small>
            </label>

            <label className="team-field">
              <span>Job title *</span>
              <input
                value={form.job_title}
                onChange={(e) => updateField('job_title', e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Company *</span>
              <input
                value={form.company_name}
                onChange={(e) => updateField('company_name', e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Workplace location</span>
              <input
                value={form.workplace_location}
                onChange={(e) => updateField('workplace_location', e.target.value)}
                placeholder="City, State"
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Work setup</span>
              <input
                value={form.work_setup}
                onChange={(e) => updateField('work_setup', e.target.value)}
                placeholder="Onsite, Hybrid, or Remote"
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Salary</span>
              <input
                value={form.salary}
                onChange={(e) => updateField('salary', e.target.value)}
                placeholder="$140K/yr - $170K/yr"
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Required level</span>
              <input
                value={form.required_level}
                onChange={(e) => updateField('required_level', e.target.value)}
                placeholder="Senior Level"
                disabled={busy}
              />
            </label>
            <label className="team-field">
              <span>Required experience</span>
              <input
                value={form.required_experience}
                onChange={(e) =>
                  updateField('required_experience', e.target.value)
                }
                placeholder="8+ years"
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
              {submitting ? 'Saving...' : 'Add job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default JobFormModal;
