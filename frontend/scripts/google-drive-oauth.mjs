/**
 * One-time OAuth helper for Google Drive refresh token.
 *
 * Redirect URI (InterviewManagement client):
 *   http://localhost:53682/oauth2callback
 *
 * Usage:
 *   cd frontend
 *   node scripts/google-drive-oauth.mjs
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import {
  DRIVE_OAUTH_REDIRECT_URI,
  GOOGLE_AUTH_URI,
  GOOGLE_TOKEN_URI,
} from '../server/googleOAuthConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../.env');
const PORT = 53682;
const REDIRECT_URI = DRIVE_OAUTH_REDIRECT_URI;
const SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
].join(' ');

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
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

function upsertEnvValue(filePath, key, value) {
  const line = `${key}=${value}`;
  let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) {
    text = text.replace(pattern, line);
  } else {
    text = `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(filePath, text, 'utf8');
}

const fileEnv = loadEnvFile(ENV_PATH);
const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || fileEnv.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || fileEnv.GOOGLE_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in frontend/.env first.',
  );
  process.exit(1);
}

const authUrl = new URL(GOOGLE_AUTH_URI);
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = reqUrl.searchParams.get('code');
    const error = reqUrl.searchParams.get('error');
    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`OAuth failed: ${error || 'missing code'}`);
      server.close();
      process.exit(1);
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(
        `Token exchange failed: ${tokens.error_description || tokens.error || 'no refresh_token'}\n\n${JSON.stringify(tokens, null, 2)}`,
      );
      console.error(tokens);
      server.close();
      process.exit(1);
    }

    upsertEnvValue(ENV_PATH, 'GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
    upsertEnvValue(ENV_PATH, 'GOOGLE_DRIVE_FOLDER_NAME', 'Interview Recordings');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<h1>Google Drive connected</h1><p>Refresh token saved to <code>frontend/.env</code>. Restart <code>npm run dev</code>.</p>',
    );

    console.log('\nSaved GOOGLE_REFRESH_TOKEN to frontend/.env');
    console.log('Restart Vite, then upload from Report → Video.\n');

    server.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(String(err.message || err));
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this URL and approve Drive access:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting on ${REDIRECT_URI} ...\n`);
});
