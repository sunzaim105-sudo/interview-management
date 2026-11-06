import './ToastStack.css';

function ToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <aside key={toast.id} className="toast-card" role="status">
          <div className="toast-card__head">
            <strong>{toast.title}</strong>
            <button
              type="button"
              className="toast-card__close"
              aria-label="Dismiss notification"
              onClick={() => onDismiss?.(toast.id)}
            >
              ×
            </button>
          </div>
          <dl className="toast-card__meta">
            {toast.time ? (
              <div>
                <dt>Time</dt>
                <dd>{toast.time}</dd>
              </div>
            ) : null}
            {toast.jobTitle ? (
              <div>
                <dt>Job</dt>
                <dd>{toast.jobTitle}</dd>
              </div>
            ) : null}
            {toast.callerName ? (
              <div>
                <dt>Caller</dt>
                <dd>{toast.callerName}</dd>
              </div>
            ) : null}
            {toast.memberName ? (
              <div>
                <dt>Invited</dt>
                <dd>{toast.memberName}</dd>
              </div>
            ) : null}
          </dl>
          {toast.subtitle ? <p className="toast-card__subtitle">{toast.subtitle}</p> : null}
        </aside>
      ))}
    </div>
  );
}

export default ToastStack;
