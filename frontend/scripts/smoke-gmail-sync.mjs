import { loadEnv } from 'vite';
import {
  buildGmailAuthUrl,
  getGmailOAuthConfig,
  matchesInterviewMailKeywords,
  INTERVIEW_MAIL_BASE_QUERY,
} from '../server/gmailClient.js';
import {
  createAccountLimiter,
  isQuotaError,
  tryAcquireSyncLock,
} from '../server/gmailRateLimit.js';
import { withGoogleEnvFile } from '../server/googleOAuthConfig.js';

const env = withGoogleEnvFile(loadEnv('development', process.cwd(), ''));
const cfg = getGmailOAuthConfig(env);

if (!cfg.clientId || !cfg.redirectUri) {
  console.error('FAIL: missing OAuth config');
  process.exit(1);
}

const url = buildGmailAuthUrl({
  clientId: cfg.clientId,
  redirectUri: cfg.redirectUri,
  state: 'teststate.sig',
  loginHint: 'member@example.com',
  env,
});
const parsed = new URL(url);
if (!parsed.pathname.includes('/o/oauth2/v2/auth')) {
  console.error('FAIL: expected v2 auth endpoint', parsed.pathname);
  process.exit(1);
}
if (parsed.searchParams.get('redirect_uri') !== cfg.redirectUri) {
  console.error('FAIL: redirect_uri mismatch');
  process.exit(1);
}
if (!parsed.searchParams.get('client_id')) {
  console.error('FAIL: missing client_id');
  process.exit(1);
}

if (!matchesInterviewMailKeywords({ subject: 'Technical interview invite' })) {
  console.error('FAIL: keyword match');
  process.exit(1);
}

const lim = createAccountLimiter('smoke');
const t0 = Date.now();
await Promise.all(
  [1, 2, 3].map(() =>
    lim.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
    }),
  ),
);
const elapsed = Date.now() - t0;
if (elapsed < 300) {
  console.error('FAIL: limiter did not pace concurrent work', elapsed);
  process.exit(1);
}

const a = tryAcquireSyncLock('acct-smoke');
const b = tryAcquireSyncLock('acct-smoke');
if (!a.ok || b.ok) {
  console.error('FAIL: sync lock');
  process.exit(1);
}
a.release();

if (
  !isQuotaError({
    message:
      "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'",
  })
) {
  console.error('FAIL: quota detection');
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      authEndpoint: parsed.origin + parsed.pathname,
      redirectUri: cfg.redirectUri,
      queryPrefix: INTERVIEW_MAIL_BASE_QUERY.slice(0, 48),
      limiterElapsedMs: elapsed,
    },
    null,
    2,
  ),
);
