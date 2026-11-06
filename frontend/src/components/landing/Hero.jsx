import { Link } from 'react-router-dom';
import './Hero.css';

function Hero() {
  return (
    <section className="hero">
      <div className="hero__inner">
        <div className="hero__copy">
          <span className="hero__badge">FOR RECRUITERS AND TALENT TEAMS</span>

          <h1 className="hero__title">
            Interview scheduling software
            <span className="hero__title-accent"> that fills your calendar.</span>
          </h1>

          <p className="hero__subtitle">
            Let candidates self-schedule interviews around your team&apos;s real
            availability, with no back-and-forth. Cal ID shares interviews
            round-robin across interviewers, routes each candidate to the right
            role, and sends reminders that cut interview no-shows, so you fill
            roles faster.
          </p>

          <div className="hero__actions">
            <Link to="/signin" className="btn btn--primary">
              Sign In
            </Link>
            <Link to="/signup" className="btn btn--secondary">
              Sign up
            </Link>
          </div>

          <p className="hero__trust">
            Candidate self-scheduling · No back-and-forth · No credit card
          </p>
        </div>

        <div className="hero__preview" aria-hidden="true">
          <div className="confirm-card">
            <ol className="confirm-card__steps">
              <li className="confirm-card__step confirm-card__step--done">
                <span className="confirm-card__step-icon">
                  <CheckIcon />
                </span>
                <span>Website</span>
              </li>
              <li className="confirm-card__connector" />
              <li className="confirm-card__step confirm-card__step--done">
                <span className="confirm-card__step-icon">
                  <CheckIcon />
                </span>
                <span>Booking</span>
              </li>
              <li className="confirm-card__connector" />
              <li className="confirm-card__step confirm-card__step--done">
                <span className="confirm-card__step-icon">
                  <CheckIcon />
                </span>
                <span>Details</span>
              </li>
              <li className="confirm-card__connector" />
              <li className="confirm-card__step confirm-card__step--current">
                <span className="confirm-card__step-icon">4</span>
                <span>Confirmed</span>
              </li>
            </ol>

            <div className="confirm-card__success">
              <span className="confirm-card__success-icon">
                <CheckIcon large />
              </span>
              <h2>This meeting is scheduled</h2>
              <p>We emailed everyone a calendar invite with the details.</p>
            </div>

            <div className="confirm-card__details">
              <div className="confirm-card__row">
                <span className="confirm-card__label">What</span>
                <span className="confirm-card__value">
                  Interview between Sarah Lin and Alex Rivera
                </span>
              </div>
              <div className="confirm-card__row">
                <span className="confirm-card__label">When</span>
                <span className="confirm-card__value">
                  Wed, Jun 24, 2026
                  <span className="confirm-card__meta">9:30 am – 30 min</span>
                </span>
              </div>
              <div className="confirm-card__row">
                <span className="confirm-card__label">Who</span>
                <span className="confirm-card__value confirm-card__value--who">
                  <span>
                    Sarah Lin <span className="confirm-card__host">Host</span>
                  </span>
                  <span>Alex Rivera</span>
                </span>
              </div>
              <div className="confirm-card__row">
                <span className="confirm-card__label">Where</span>
                <span className="confirm-card__value confirm-card__value--where">
                  <MeetIcon />
                  Google Meet
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckIcon({ large = false }) {
  const size = large ? 28 : 12;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function MeetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" fill="#00832D" />
      <path d="M16 10l5-3v10l-5-3v-4z" fill="#FFBA00" />
      <path d="M16 10l5-3v3.5L16 13V10z" fill="#FF7100" />
      <path d="M16 14l5 3v-3.5L16 11v3z" fill="#00AC47" />
    </svg>
  );
}

export default Hero;
