/**
 * Per-account Gmail API pacing: min interval, bounded concurrency,
 * exponential backoff with jitter for 403/429 quota errors.
 * Non-retryable 400s fail immediately (no retry loops).
 */

const DEFAULTS = {
  minIntervalMs: 350,
  maxConcurrent: 1,
  maxRetries: 4,
  baseDelayMs: 800,
  maxDelayMs: 30_000,
  quotaCooldownMs: 65_000,
};

export function isQuotaError(err) {
  const status = Number(err?.gmailStatus || err?.status || 0);
  const message = String(err?.message || '').toLowerCase();
  const reason = String(err?.reason || '').toLowerCase();
  if (status === 429) return true;
  if (
    status === 403 &&
    (reason.includes('ratelimit') ||
      reason.includes('quota') ||
      message.includes('quota exceeded') ||
      message.includes('rate limit') ||
      message.includes('user-rate') ||
      message.includes('userratelimit'))
  ) {
    return true;
  }
  return (
    message.includes('quota exceeded') ||
    message.includes('rate limit exceeded') ||
    message.includes('user-rate limit')
  );
}

export function isRetryableGmailError(err) {
  if (isQuotaError(err)) return true;
  const status = Number(err?.gmailStatus || 0);
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export function isMalformedGmailError(err) {
  const status = Number(err?.gmailStatus || err?.status || 0);
  const message = String(err?.message || '').toLowerCase();
  return (
    status === 400 &&
    (message.includes('malformed') ||
      message.includes('invalid') ||
      message.includes('failed precondition') ||
      message.includes('required'))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  const spread = Math.floor(ms * 0.25);
  return ms + Math.floor(Math.random() * (spread + 1));
}

export function createAccountLimiter(accountKey, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let chain = Promise.resolve();
  let active = 0;
  let lastStartedAt = 0;
  let cooldownUntil = 0;
  const waiters = [];

  function pump() {
    while (active < cfg.maxConcurrent && waiters.length) {
      const now = Date.now();
      if (now < cooldownUntil) break;
      const gap = cfg.minIntervalMs - (now - lastStartedAt);
      if (gap > 0 && active > 0) break;
      if (gap > 0 && active === 0) {
        const waitMs = Math.max(gap, cooldownUntil - now);
        if (waitMs > 0) {
          setTimeout(pump, waitMs);
          break;
        }
      }
      const next = waiters.shift();
      if (!next) break;
      active += 1;
      lastStartedAt = Date.now();
      next();
    }
  }

  function scheduleSlot() {
    return new Promise((resolve) => {
      waiters.push(resolve);
      pump();
    });
  }

  function releaseSlot() {
    active = Math.max(0, active - 1);
    pump();
  }

  async function run(fn) {
    // Serialize acquisition so cooldown/interval stay per-account.
    const runPromise = chain.then(async () => {
      if (Date.now() < cooldownUntil) {
        const wait = cooldownUntil - Date.now();
        if (wait > 0) await sleep(wait);
      }
      await scheduleSlot();
      try {
        return await fn();
      } finally {
        releaseSlot();
      }
    });
    // Keep chain alive even when a call fails.
    chain = runPromise.then(
      () => undefined,
      () => undefined,
    );
    return runPromise;
  }

  async function withBackoff(fn) {
    let attempt = 0;
    for (;;) {
      try {
        return await run(fn);
      } catch (err) {
        if (isMalformedGmailError(err) || !isRetryableGmailError(err)) {
          throw err;
        }
        if (attempt >= cfg.maxRetries) throw err;
        if (isQuotaError(err)) {
          cooldownUntil = Date.now() + cfg.quotaCooldownMs;
        }
        const delay = jitter(
          Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** attempt),
        );
        attempt += 1;
        await sleep(delay);
      }
    }
  }

  function markQuotaCooldown(ms = cfg.quotaCooldownMs) {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
  }

  function inCooldown() {
    return Date.now() < cooldownUntil;
  }

  function cooldownRemainingMs() {
    return Math.max(0, cooldownUntil - Date.now());
  }

  return {
    key: accountKey,
    run,
    withBackoff,
    markQuotaCooldown,
    inCooldown,
    cooldownRemainingMs,
  };
}

const limiters = new Map();

export function getAccountLimiter(accountId) {
  const key = String(accountId || 'anonymous');
  if (!limiters.has(key)) {
    limiters.set(key, createAccountLimiter(key));
  }
  return limiters.get(key);
}

/** In-process sync lock so OAuth / poll / Full sync cannot overlap per account. */
const syncLocks = new Map();

export function tryAcquireSyncLock(accountId) {
  const key = String(accountId);
  const current = syncLocks.get(key);
  if (current?.running) {
    return {
      ok: false,
      reason: 'Sync already in progress for this Gmail account.',
    };
  }
  const token = { running: true, startedAt: Date.now() };
  syncLocks.set(key, token);
  return { ok: true, release: () => {
    if (syncLocks.get(key) === token) syncLocks.delete(key);
  } };
}
