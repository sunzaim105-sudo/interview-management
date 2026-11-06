import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(__dirname, '../.browser-profile');
const BROWSER_TIMEOUT_MS = Number(process.env.JOB_SCRAPE_BROWSER_TIMEOUT_MS || 120_000);

/**
 * Fetch HTML with Playwright for JS-rendered or bot-protected pages.
 * When interactive=true, opens a visible browser so the user can complete
 * CAPTCHA / login. Never bypasses protections. Cookies stay in a local
 * profile directory and are never returned to the client.
 */
export async function fetchHtmlWithBrowser(url, { interactive = false } = {}) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw Object.assign(
      new Error(
        'Browser import requires Playwright. Run: npm install playwright && npx playwright install chromium',
      ),
      { code: 'PLAYWRIGHT_MISSING' },
    );
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const { chromium } = playwright;
  const launchOptions = {
    headless: !interactive,
    channel: process.env.JOB_SCRAPE_BROWSER_CHANNEL || undefined,
  };

  let context;
  let browser;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...launchOptions,
      viewport: { width: 1400, height: 900 },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    // Fall back to ephemeral browser if persistent profile fails.
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1400, height: 900 },
    });
  }

  const page = context.pages()[0] || (await context.newPage());
  const embedHints = { can_embed: true, xFrameOptions: '', csp: '' };

  page.on('response', (response) => {
    try {
      if (response.url().split('?')[0] !== url.split('?')[0] && response.request().resourceType() !== 'document') {
        return;
      }
      if (response.request().resourceType() !== 'document') return;
      const headers = response.headers();
      embedHints.xFrameOptions = headers['x-frame-options'] || embedHints.xFrameOptions;
      embedHints.csp = headers['content-security-policy'] || embedHints.csp;
      embedHints.can_embed = canEmbedFromHeaders(embedHints.xFrameOptions, embedHints.csp);
    } catch {
      // ignore
    }
  });

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: BROWSER_TIMEOUT_MS,
    });

    if (interactive) {
      await waitForChallengeClear(page, BROWSER_TIMEOUT_MS);
    } else {
      // Brief settle for SPA hydration; do not wait forever on CAPTCHA.
      await page.waitForTimeout(2500);
      const challenged = await isChallengePage(page);
      if (challenged) {
        throw Object.assign(
          new Error(
            'This site requires CAPTCHA or login. Click Import again with interactive browser enabled, complete the check in the opened window, then wait.',
          ),
          { code: 'NEEDS_INTERACTIVE' },
        );
      }
    }

    await waitForJobContent(page, 20_000).catch(() => {});
    const html = await page.content();
    const finalUrl = page.url();
    return { html, finalUrl, can_embed: embedHints.can_embed };
  } finally {
    await context.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export function canEmbedFromHeaders(xFrameOptions = '', csp = '') {
  const xfo = String(xFrameOptions || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
  const frameAncestors = String(csp || '').match(/frame-ancestors\s+([^;]+)/i)?.[1] || '';
  if (!frameAncestors) return true;
  if (/none/i.test(frameAncestors)) return false;
  if (/^\s*'self'\s*$/i.test(frameAncestors.trim())) return false;
  return /\*/.test(frameAncestors) || /https?:/.test(frameAncestors);
}

async function isChallengePage(page) {
  const title = (await page.title().catch(() => '')) || '';
  if (/just a moment|attention required|security verification/i.test(title)) {
    return true;
  }
  const body = await page.locator('body').innerText().catch(() => '');
  return /performing security verification|verify you are human|cf-turnstile/i.test(
    body,
  );
}

async function waitForChallengeClear(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const challenged = await isChallengePage(page);
    if (!challenged) {
      // Allow SPA to hydrate after challenge clears.
      await page.waitForTimeout(1500);
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw Object.assign(
    new Error(
      'Timed out waiting for CAPTCHA/login. Complete the check in the browser window and try Import again.',
    ),
    { code: 'CHALLENGE_TIMEOUT' },
  );
}

async function waitForJobContent(page, timeoutMs) {
  await Promise.race([
    page.waitForSelector('script#__NEXT_DATA__', { timeout: timeoutMs }),
    page.waitForSelector('h1', { timeout: timeoutMs }),
    page.waitForSelector('[itemtype*="JobPosting"]', { timeout: timeoutMs }),
    page.waitForFunction(
      () =>
        Boolean(
          document.querySelector('script[type="application/ld+json"]') ||
            document.body?.innerText?.length > 800,
        ),
      { timeout: timeoutMs },
    ),
  ]);
}

export function browserProfileDir() {
  return PROFILE_DIR;
}
