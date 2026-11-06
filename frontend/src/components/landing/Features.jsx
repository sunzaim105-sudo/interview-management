import './Features.css';

const FEATURES = [
  {
    title: 'Recruiter screens',
    description:
      "Let candidates self-book their first screen straight from your outreach.",
  },
  {
    title: 'Hiring manager interviews',
    description:
      "Share the manager's availability so candidates book without the email tag.",
  },
  {
    title: 'Panel and technical rounds',
    description:
      'Share interviews round-robin across interviewers so no one is overloaded.',
  },
  {
    title: 'Candidate routing',
    description:
      'Route each candidate to the right recruiter and role with a short form.',
  },
  {
    title: 'Resume collection',
    description:
      'Collect resumes and screening answers up front, before the interview.',
  },
  {
    title: 'Onboarding calls',
    description:
      'Let new hires book onboarding and orientation sessions themselves.',
  },
];

function Features() {
  return (
    <section className="features">
      <div className="features__inner">
        <header className="features__header">
          <h2>What recruiters use Cal ID for</h2>
          <p>One scheduling system for every stage of hiring.</p>
        </header>

        <div className="features__grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="features__item">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default Features;
