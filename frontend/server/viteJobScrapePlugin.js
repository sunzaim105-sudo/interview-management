import { loadEnv } from 'vite';
import { scrapeJobFromUrl } from './jobScrape.js';
import { parseResumeFile } from './resumeParse.js';
import {
  assertWorkspaceEditor,
  getBearerToken,
} from './supabaseAuth.js';

const MAX_BODY_BYTES = 12 * 1024 * 1024;

function readJsonBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(
          Object.assign(new Error('Request body too large.'), { status: 413 }),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function jobScrapePlugin() {
  return {
    name: 'job-scrape-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        if (url === '/api/jobs/scrape') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed.' });
            return;
          }

          try {
            const env = loadEnv(server.config.mode, process.cwd(), '');
            const body = await readJsonBody(req, { maxBytes: 64 * 1024 });
            await assertWorkspaceEditor(env, getBearerToken(req, body));
            const data = await scrapeJobFromUrl(body?.url || body?.job_link);
            sendJson(res, 200, { data });
          } catch (err) {
            sendJson(res, err.status || 400, {
              error: err?.message || 'Failed to scrape job link.',
            });
          }
          return;
        }

        if (url === '/api/team/parse-resume') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed.' });
            return;
          }

          try {
            const env = loadEnv(server.config.mode, process.cwd(), '');
            const body = await readJsonBody(req);
            await assertWorkspaceEditor(env, getBearerToken(req, body));
            const data = await parseResumeFile({
              filename: body?.filename,
              contentType: body?.contentType,
              dataBase64: body?.dataBase64,
            });
            sendJson(res, 200, { data });
          } catch (err) {
            sendJson(res, err.status || 400, {
              error: err?.message || 'Failed to parse resume.',
            });
          }
          return;
        }

        return next();
      });
    },
  };
}
