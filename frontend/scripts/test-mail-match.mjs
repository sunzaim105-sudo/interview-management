import {
  INTERVIEW_MAIL_BASE_QUERY,
  collectForwardMatchEmailWeights,
  extractEmailAddress,
} from '../server/gmailClient.js';

const expected =
  'newer_than:7d -category:promotions -category:social {interview assessment recruiter "next steps" "schedule a call" "book a time" "technical interview" "coding challenge" shortlisted calendly}';

if (INTERVIEW_MAIL_BASE_QUERY !== expected) {
  console.error('Query mismatch:\n', INTERVIEW_MAIL_BASE_QUERY);
  process.exit(1);
}

function pickBest(weights, members, central) {
  const scores = new Map();
  for (const [email, weight] of weights.entries()) {
    if (central && email === central) continue;
    const member = members.find((m) => m.email === email);
    if (!member) continue;
    scores.set(member.id, (scores.get(member.id) || 0) + weight);
  }
  let best = null;
  let bestScore = 0;
  for (const [id, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return { best, bestScore };
}

const members = [
  { id: 'alice', email: 'alice@example.com' },
  { id: 'bob', email: 'bob@example.com' },
];
const central = 'inbox@calid.test';

// Case 1: Gmail auto-forward — X-Forwarded-For is the original owner.
{
  const weights = collectForwardMatchEmailWeights({
    from: 'Recruiter <recruiter@acme.com>',
    to: central,
    subject: 'Interview next steps',
    bodyText: 'Please reply. Also looping bob@example.com for awareness.',
    rawHeaders: {
      'X-Forwarded-For': 'alice@example.com',
      'Delivered-To': central,
    },
  });
  const result = pickBest(weights, members, central);
  if (result.best !== 'alice') {
    console.error('Expected alice from X-Forwarded-For, got', result);
    process.exit(1);
  }
  console.log('ok: X-Forwarded-For prefers alice over body mention of bob');
}

// Case 2: Classic forwarded block To: line
{
  const weights = collectForwardMatchEmailWeights({
    from: 'alice@example.com',
    to: central,
    subject: 'Fwd: coding challenge',
    bodyText: '---------- Forwarded message ---------\nFrom: Recruiter <r@x.com>\nTo: bob@example.com\nSubject: coding challenge\n',
    rawHeaders: {},
  });
  const result = pickBest(weights, members, central);
  // Forwarded To: bob (11) + From alice (9) — bob should win on To: line weight
  if (result.best !== 'bob' && result.best !== 'alice') {
    console.error('Expected bob or alice from forward block', result);
    process.exit(1);
  }
  console.log('ok: forward block matched', result.best, 'score', result.bestScore);
}

// Case 3: central address ignored
{
  const weights = collectForwardMatchEmailWeights({
    from: 'recruiter@acme.com',
    to: central,
    subject: 'interview',
    bodyText: '',
    rawHeaders: { 'Delivered-To': central },
  });
  const result = pickBest(weights, members, central);
  if (result.best !== null) {
    console.error('Expected no member match', result);
    process.exit(1);
  }
  console.log('ok: central inbox alone does not match a team member');
}

console.log('extract', extractEmailAddress('Name <x@y.com>'));
console.log('All mail match tests passed.');
console.log('Query:', INTERVIEW_MAIL_BASE_QUERY);
