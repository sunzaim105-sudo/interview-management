import crypto from 'node:crypto';

function requireSecret(secret, purpose) {
  const value = String(secret || '').trim();
  if (!value) {
    throw Object.assign(
      new Error(
        `GMAIL_TOKEN_SECRET (or SUPABASE_SECRET_KEY) is required to ${purpose}.`,
      ),
      { status: 500 },
    );
  }
  return value;
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(requireSecret(secret, 'derive keys')).digest();
}

export function encryptSecret(plainText, secret) {
  if (!plainText) return '';
  const keySecret = requireSecret(secret, 'store OAuth tokens');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(keySecret), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

export function decryptSecret(payload, secret) {
  if (!payload) return '';
  const keySecret = requireSecret(secret, 'read OAuth tokens');
  const buf = Buffer.from(String(payload), 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(keySecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function signOAuthState(payload, secret) {
  const keySecret = requireSecret(secret, 'sign OAuth state');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyOAuthState(state, secret, maxAgeMs = 15 * 60 * 1000) {
  const keySecret = requireSecret(secret, 'verify OAuth state');
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) throw Object.assign(new Error('Invalid OAuth state.'), { status: 400 });
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw Object.assign(new Error('Invalid OAuth state signature.'), { status: 400 });
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload?.ts || Date.now() - Number(payload.ts) > maxAgeMs) {
    throw Object.assign(new Error('OAuth state expired. Try Connect Gmail again.'), {
      status: 400,
    });
  }
  return payload;
}
