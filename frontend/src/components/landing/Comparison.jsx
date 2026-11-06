import './Comparison.css';

const WITHOUT = [
  {
    title: 'Endless email tag',
    description:
      'You trade emails between candidates and interviewers just to find one time that works.',
  },
  {
    title: 'Candidates go cold',
    description:
      'The longer scheduling drags on, the more good candidates take another offer.',
  },
  {
    title: 'Interviews hit the wrong person',
    description:
      'Slots land with whoever is free, not the right interviewer for the role.',
  },
  {
    title: 'No-shows waste panel time',
    description:
      'Candidates forget, and a whole interview panel loses the slot.',
  },
];

const WITH = [
  {
    title: 'Candidates self-schedule',
    description:
      'Candidates pick a time from one link in seconds, in their own timezone.',
  },
  {
    title: 'Shared round-robin',
    description:
      'Interviews are split evenly across interviewers so no one is overloaded.',
  },
  {
    title: 'Routed to the right role',
    description:
      'A short form sends each candidate to the right recruiter and interview.',
  },
  {
    title: 'Far fewer no-shows',
    description:
      'Automatic email, SMS and WhatsApp reminders keep candidates on track.',
  },
];

function Comparison() {
  return (
    <section className="comparison">
      <div className="comparison__inner">
        <header className="comparison__header">
          <h2>Stop scheduling interviews over email</h2>
          <p>
            Most teams still set up interviews through back-and-forth emails
            between candidates and interviewers. Interview scheduling software
            lets candidates self-schedule and shares the load across your panel.
          </p>
        </header>

        <div className="comparison__cards">
          <article className="compare-card compare-card--without">
            <p className="compare-card__label">WITHOUT CAL ID</p>
            <ul className="compare-card__list">
              {WITHOUT.map((item) => (
                <li key={item.title}>
                  <span className="compare-card__icon compare-card__icon--x">
                    <XIcon />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="compare-card compare-card--with">
            <p className="compare-card__label compare-card__label--blue">
              WITH CAL ID
            </p>
            <ul className="compare-card__list">
              {WITH.map((item) => (
                <li key={item.title}>
                  <span className="compare-card__icon compare-card__icon--check">
                    <CheckIcon />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l5 5L19 7"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default Comparison;
