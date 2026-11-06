/**
 * Google Cloud OAuth — InterviewManagement (interviewmanagement-513820)
 */
import fs from 'node:fs';
import path from 'node:path';

export const GOOGLE_PROJECT_ID = 'interviewmanagement-513820';

export const GOOGLE_AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CERT_URL =
  'https://www.googleapis.com/oauth2/v1/certs';

/** Authorized redirect URIs on the InterviewManagement OAuth client. */
export const GMAIL_OAUTH_REDIRECT_URI =
  'http://localhost:5173/api/gmail/oauth/callback';
export const DRIVE_OAUTH_REDIRECT_URI =
  'http://localhost:53682/oauth2callback';

export const APP_ORIGIN = 'http://localhost:5173';

const GOOGLE_ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_AUTH_URI',
  'GOOGLE_TOKEN_URI',
  'GOOGLE_CERT_URL',
  'GOOGLE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_FOLDER_NAME',
  'GOOGLE_DRIVE_FOLDER_ID',
  'GMAIL_OAUTH_REDIRECT_URI',
  'APP_ORIGIN',
  'GMAIL_TOKEN_SECRET',
  'GMAIL_CENTRAL_ADDRESS',
];

/** Read key/value pairs from frontend/.env (file wins over stale process.env). */
export function readEnvFile(cwd = process.cwd()) {
  const filePath = path.resolve(cwd, '.env');
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Merge Vite loadEnv with .env file so Google keys are never stuck on old process.env. */
export function withGoogleEnvFile(env = {}, cwd = process.cwd()) {
  const fileEnv = readEnvFile(cwd);
  const merged = { ...env };
  for (const key of GOOGLE_ENV_KEYS) {
    if (fileEnv[key] !== undefined) merged[key] = fileEnv[key];
  }
  return merged;
}

export function getGoogleOAuthEndpoints(env = {}) {
  const e = withGoogleEnvFile(env);
  return {
    authUri: e.GOOGLE_AUTH_URI || GOOGLE_AUTH_URI,
    tokenUri: e.GOOGLE_TOKEN_URI || GOOGLE_TOKEN_URI,
    certUrl: e.GOOGLE_CERT_URL || GOOGLE_CERT_URL,
  };
}

export function getGoogleClientCredentials(env = {}) {
  const e = withGoogleEnvFile(env);
  const clientId = String(e.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(e.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw Object.assign(
      new Error(
        'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in frontend/.env.',
      ),
      { status: 500 },
    );
  }
  return { clientId, clientSecret };
}
