import { useEffect, useState } from 'react';
import './CallerProfileModal.css';

const EMPTY = {
  name: '',
  location: '',
  email: '',
  whatsapp_number: '',
  linkedin_url: '',
  freelancer_profile_url: '',
  notes: '',
};

function CallerProfileModal({ open, caller, onClose, onSubmit }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      name: caller?.name || caller?.username || '',
      location: caller?.location || '',
      email: caller?.email || '',
      whatsapp_number: caller?.whatsapp_number || '',
      linkedin_url: caller?.linkedin_url || '',
      freelancer_profile_url: caller?.freelancer_profile_url || '',
      notes: caller?.notes || '',
    });
    setError('');
    setSubmitting(false);
  }, [open, caller]);

  if (!open || !caller) return null;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError('Caller name is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        location: form.location.trim(),
        email: form.email.trim(),
        whatsapp_number: form.whatsapp_number.trim(),
        linkedin_url: form.linkedin_url.trim(),
        freelancer_profile_url: form.freelancer_profile_url.trim(),
        notes: form.notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save caller profile.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="caller-modal-backdrop" onClick={onClose}>
      <div
        className="caller-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="caller-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="caller-modal__head">
          <div>
            <p className="caller-modal__eyebrow">Caller profile</p>
            <h2 id="caller-profile-title">
              {caller.username || caller.name || 'Caller'}
            </h2>
          </div>
          <button type="button" className="caller-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="caller-modal__form" onSubmit={handleSubmit}>
          {error ? <div className="caller-modal__error">{error}</div> : null}

          <label>
            <span>Caller name *</span>
            <input
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              required
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
            />
          </label>

          <label>
            <span>Location</span>
            <input
              value={form.location}
              onChange={(e) => updateField('location', e.target.value)}
              placeholder="City, Country"
            />
          </label>

          <label>
            <span>WhatsApp number</span>
            <input
              value={form.whatsapp_number}
              onChange={(e) => updateField('whatsapp_number', e.target.value)}
              placeholder="+1 555 000 0000"
            />
          </label>

          <label>
            <span>LinkedIn link</span>
            <input
              type="url"
              value={form.linkedin_url}
              onChange={(e) => updateField('linkedin_url', e.target.value)}
              placeholder="https://linkedin.com/in/..."
            />
          </label>

          <label>
            <span>Freelancer profile link</span>
            <input
              type="url"
              value={form.freelancer_profile_url}
              onChange={(e) =>
                updateField('freelancer_profile_url', e.target.value)
              }
              placeholder="https://..."
            />
          </label>

          <label>
            <span>Notes</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
            />
          </label>

          <div className="caller-modal__actions">
            <button type="button" className="caller-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="caller-btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CallerProfileModal;
