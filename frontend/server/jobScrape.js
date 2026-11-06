const MAX_HTML_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 15_000;

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\])/i;

function isPrivateHostname(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h || PRIVATE_HOST_RE.test(h) || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // 172.16.0.0/12
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 unique-local / link-local
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

const EMPTY_JOB = {
  job_title: '',
  company_name: '',
  workplace_location: '',
  work_setup: '',
  salary: '',
  required_level: '',
  required_experience: '',
  source: 'none',
};

/**
 * Fetch a job posting URL and extract only summary metadata fields.
 * Does not scrape or return job description body text.
 *
 * When a site blocks automated HTML fetches (e.g. Cloudflare on aiapply.co),
 * falls back to public link-preview endpoints that still return title/company.
 */
export async function scrapeJobFromUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  assertSafeUrl(url);

  let extracted = { ...EMPTY_JOB };
  let fetchError = null;

  try {
    const html = await fetchHtml(url);
    extracted = extractRelevantJobFields(html, url);
  } catch (err) {
    fetchError = err;
  }

  if (!extracted.job_title && !extracted.company_name) {
    const fromEmbed = await fetchViaLinkPreview(url);
    if (scoreCandidate(fromEmbed) > scoreCandidate(extracted)) {
      extracted = {
        ...extracted,
        ...fromEmbed,
        job_title: firstNonEmpty(fromEmbed.job_title, extracted.job_title),
        company_name: firstNonEmpty(
          fromEmbed.company_name,
          extracted.company_name,
        ),
      };
    }
  }

  if (!extracted.job_title && !extracted.company_name) {
    if (fetchError) throw fetchError;
    throw new Error(
      'Could not find job details on that page. Enter the fields manually.',
    );
  }

  return {
    job_link: url.toString(),
    job_title: extracted.job_title,
    company_name: extracted.company_name,
    workplace_location: extracted.workplace_location,
    work_setup: extracted.work_setup,
    salary: extracted.salary,
    required_level: extracted.required_level,
    required_experience: extracted.required_experience,
    source: extracted.source,
  };
}

export function extractRelevantJobFields(html, pageUrl) {
  const fromNext = extractFromNextData(html);
  const fromJsonLd = extractFromJsonLd(html);
  const fromMeta = extractFromMeta(html);
  const fromDom = extractFromDomHints(html);

  const primary =
    scoreCandidate(fromNext) >= scoreCandidate(fromJsonLd) &&
    scoreCandidate(fromNext) >= scoreCandidate(fromDom)
      ? fromNext
      : scoreCandidate(fromDom) >= scoreCandidate(fromJsonLd)
        ? fromDom
        : fromJsonLd;

  const job_title = firstNonEmpty(
    primary.job_title,
    fromDom.job_title,
    fromJsonLd.job_title,
    fromMeta.job_title,
  );

  const company_name = firstNonEmpty(
    primary.company_name,
    fromJsonLd.company_name,
    fromDom.company_name,
    companyFromTitle(fromMeta.job_title || job_title),
    fromMeta.company_name,
    companyFromPath(pageUrl),
    guessCompanyFromUrl(pageUrl),
  );

  return {
    job_title: stripCompanySuffix(job_title, company_name),
    company_name,
    workplace_location: firstNonEmpty(
      primary.workplace_location,
      fromJsonLd.workplace_location,
      fromDom.workplace_location,
    ),
    work_setup: firstNonEmpty(
      primary.work_setup,
      fromJsonLd.work_setup,
      fromDom.work_setup,
    ),
    salary: firstNonEmpty(primary.salary, fromJsonLd.salary, fromDom.salary),
    required_level: firstNonEmpty(
      primary.required_level,
      fromJsonLd.required_level,
      fromDom.required_level,
    ),
    required_experience: firstNonEmpty(
      primary.required_experience,
      fromJsonLd.required_experience,
      fromDom.required_experience,
    ),
    source: primary.source || 'none',
  };
}

function scoreCandidate(candidate = EMPTY_JOB) {
  let score = 0;
  if (candidate.job_title) score += 2;
  if (candidate.company_name) score += 2;
  if (candidate.workplace_location) score += 3;
  if (candidate.work_setup) score += 3;
  if (candidate.salary) score += 3;
  if (candidate.required_level) score += 2;
  if (candidate.required_experience) score += 2;
  if (candidate.source === 'next-data') score += 4;
  return score;
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) throw new Error('Job link is required.');

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid job URL (https://...).');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https job links are supported.');
  }

  return url;
}

function assertSafeUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) job links can be scraped.');
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error('That host cannot be scraped.');
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Manual redirects so each hop is re-validated (blocks open SSRF via 302).
    let current = url;
    let response = null;
    for (let hop = 0; hop < 5; hop += 1) {
      assertSafeUrl(current);
      response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: BROWSER_HEADERS,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        current = new URL(location, current);
        continue;
      }
      break;
    }

    const buffer = await response.arrayBuffer();
    const html = new TextDecoder('utf-8', { fatal: false }).decode(
      buffer.byteLength > MAX_HTML_BYTES
        ? buffer.slice(0, MAX_HTML_BYTES)
        : buffer,
    );

    if (isBotChallengePage(html, response.status)) {
      throw Object.assign(
        new Error(
          'That job site blocks automated import (bot protection). Enter details manually, or try a direct employer/ATS link.',
        ),
        { code: 'BOT_PROTECTED' },
      );
    }

    if (!response.ok) {
      throw new Error(`Could not open job link (HTTP ${response.status}).`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (
      contentType &&
      !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)
    ) {
      throw new Error('That link does not look like a job posting page.');
    }

    return html;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Timed out while reading the job link.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const BROWSER_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Sec-Ch-Ua':
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

function isBotChallengePage(html, status) {
  if (status === 403 || status === 503) {
    if (
      /just a moment|cf-turnstile|challenge-platform|performing security verification|attention required/i.test(
        html,
      )
    ) {
      return true;
    }
  }
  return (
    /<title[^>]*>\s*just a moment/i.test(html) &&
    /cloudflare|cf-turnstile|challenge-platform/i.test(html)
  );
}

/**
 * Public link-preview services can still resolve pages that block direct bots.
 * Used as a fallback for title/company (and light description hints).
 */
async function fetchViaLinkPreview(pageUrl) {
  const controllers = [
    fetchCardybPreview,
    fetchMicrolinkPreview,
  ];

  for (const loader of controllers) {
    try {
      const preview = await loader(pageUrl);
      if (preview?.job_title || preview?.company_name) return preview;
    } catch {
      // try next provider
    }
  }

  return { ...EMPTY_JOB };
}

async function fetchCardybPreview(pageUrl) {
  const response = await fetch(
    `https://cardyb.bsky.app/v1/extract?url=${encodeURIComponent(pageUrl.toString())}`,
    {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': BROWSER_HEADERS['User-Agent'],
      },
    },
  );
  if (!response.ok) return { ...EMPTY_JOB };
  const payload = await response.json();
  if (payload?.error || (!payload?.title && !payload?.description)) {
    return { ...EMPTY_JOB };
  }
  return extractFromLinkPreview({
    title: payload.title,
    description: payload.description,
    siteName: '',
  });
}

async function fetchMicrolinkPreview(pageUrl) {
  const response = await fetch(
    `https://api.microlink.io/?url=${encodeURIComponent(pageUrl.toString())}`,
    {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': BROWSER_HEADERS['User-Agent'],
      },
    },
  );
  if (!response.ok) return { ...EMPTY_JOB };
  const payload = await response.json();
  const data = payload?.data || {};
  return extractFromLinkPreview({
    title: data.title,
    description: data.description,
    siteName: data.publisher || data.author,
  });
}

function extractFromLinkPreview({ title, description, siteName }) {
  const cleanedTitle = asText(title)
    .replace(/\s*\|\s*AiApply Jobs\s*$/i, '')
    .replace(/\s*\|\s*AIApply\s*$/i, '')
    .trim();

  let job_title = '';
  let company_name = '';

  const atMatch = cleanedTitle.match(
    /^(.+?)\s+at\s+(.+?)(?:\s*[|\-–].*)?$/i,
  );
  if (atMatch) {
    job_title = atMatch[1].trim();
    company_name = atMatch[2].trim();
  } else {
    job_title = cleanedTitle;
    company_name = asText(siteName);
  }

  // Ignore generic marketing homepage titles.
  if (
    /job application ai|auto apply|aiapply jobs/i.test(job_title) &&
    !company_name
  ) {
    return { ...EMPTY_JOB };
  }

  const desc = asText(description);
  return {
    ...EMPTY_JOB,
    job_title,
    company_name,
    workplace_location: '',
    work_setup: guessWorkSetupFromText(desc),
    salary: guessSalaryFromText(desc),
    required_level: guessLevelFromText(`${job_title} ${desc}`),
    required_experience: guessExperienceFromText(desc),
    source: 'link-preview',
  };
}

function guessWorkSetupFromText(text) {
  if (/remote/i.test(text)) return 'Remote';
  if (/hybrid/i.test(text)) return 'Hybrid';
  if (/on[\s-]?site|onsite/i.test(text)) return 'Onsite';
  return '';
}

function guessSalaryFromText(text) {
  const match = String(text || '').match(
    /\$\s?\d[\d,]*(?:\.\d+)?\s*[kK]?(?:\s*[-–to]+\s*\$?\s?\d[\d,]*(?:\.\d+)?\s*[kK]?)?(?:\s*\/?\s*(?:yr|year|hr|hour|mo|month))?/,
  );
  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}

function guessLevelFromText(text) {
  if (/\b(staff|principal)\b/i.test(text)) return 'Staff/Principal';
  if (/\b(senior|sr\.?)\b/i.test(text)) return 'Senior Level';
  if (/\b(mid[-\s]?level|intermediate)\b/i.test(text)) return 'Mid Level';
  if (/\b(junior|jr\.?|entry[-\s]?level)\b/i.test(text)) return 'Entry Level';
  return '';
}

function guessExperienceFromText(text) {
  const match = String(text || '').match(
    /(\d+\s*\+?\s*(?:-\s*\d+\s*)?years?(?:\s+of\s+experience)?)/i,
  );
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function parseNextDataJson(html) {
  const markerMatch = html.match(/id=["']__NEXT_DATA__["']/i);
  if (!markerMatch) return null;
  const tagEnd = html.indexOf('>', markerMatch.index);
  if (tagEnd < 0) return null;
  const scriptEnd = html.indexOf('</script>', tagEnd);
  if (scriptEnd < 0) return null;
  try {
    return JSON.parse(html.slice(tagEnd + 1, scriptEnd));
  } catch {
    return null;
  }
}

function extractFromNextData(html) {
  const parsed = parseNextDataJson(html);
  if (!parsed) return { ...EMPTY_JOB };

  const pageProps = parsed?.props?.pageProps || {};
  const dataSource = pageProps.dataSource || {};
  const job = dataSource.jobResult || pageProps.jobResult || pageProps.job || null;
  const company =
    dataSource.companyResult ||
    pageProps.companyResult ||
    pageProps.company ||
    job?.company ||
    null;

  if (!job || typeof job !== 'object') return { ...EMPTY_JOB };

  return {
    job_title: asText(job.jobTitle || job.title || job.jobNlpTitle),
    company_name: asText(company?.companyName || company?.name),
    workplace_location: firstNonEmpty(
      asText(job.jobLocation),
      asStringList(job.jobLocations).join(', '),
      formatJsonLdLocation(pageProps.jobLocation),
      asText(company?.companyLocation),
    ),
    work_setup: firstNonEmpty(
      asText(job.workModel),
      job.isRemote === true ? 'Remote' : '',
    ),
    salary: firstNonEmpty(
      asText(job.salaryDesc),
      formatSalaryRange(job.minSalary, job.maxSalary, job.salaryCurrency || 'USD'),
      formatJsonLdSalary(pageProps.baseSalary),
    ),
    required_level: asText(job.jobSeniority || job.seniority || job.level),
    required_experience: formatYearsExperience(job.minYearsOfExperience),
    source: 'next-data',
  };
}

function extractFromJsonLd(html) {
  const result = { ...EMPTY_JOB };
  const scriptRe =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html))) {
    const raw = match[1].trim();
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const node of flattenJsonLd(parsed)) {
      const type = node['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (!types.some((t) => String(t).toLowerCase() === 'jobposting')) continue;

      result.job_title = asText(node.title || node.name);
      result.company_name = asText(
        node.hiringOrganization?.name ||
          node.hiringOrganization ||
          node.creator?.name,
      );
      result.workplace_location = formatJsonLdLocation(node.jobLocation);
      result.work_setup = formatWorkSetup(
        node.jobLocationType,
        node.applicantLocationRequirements,
      );
      result.salary = formatJsonLdSalary(node.baseSalary);
      result.required_level = asText(
        node.experienceRequirements?.credentialCategory ||
          node.occupationalCategory ||
          '',
      );
      result.required_experience = asText(
        node.experienceRequirements?.monthsOfExperience
          ? `${Math.round(Number(node.experienceRequirements.monthsOfExperience) / 12)}+ years`
          : node.experienceRequirements?.description ||
              (typeof node.experienceRequirements === 'string'
                ? node.experienceRequirements
                : ''),
      );
      result.source = 'json-ld';
      return result;
    }
  }

  return result;
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenJsonLd(item, out));
    return out;
  }
  if (typeof value === 'object') {
    if (value['@graph']) flattenJsonLd(value['@graph'], out);
    else out.push(value);
  }
  return out;
}

function extractFromMeta(html) {
  const meta = {};
  const metaRe =
    /<meta\s+[^>]*(?:property|name)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
  const metaReAlt =
    /<meta\s+[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = metaRe.exec(html))) {
    meta[match[1].toLowerCase()] = decodeEntities(match[2]);
  }
  while ((match = metaReAlt.exec(html))) {
    meta[match[2].toLowerCase()] = decodeEntities(match[1]);
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';

  return {
    ...EMPTY_JOB,
    job_title: firstNonEmpty(
      meta['og:title'],
      meta['twitter:title'],
      htmlToText(titleTag),
    ),
    company_name: firstNonEmpty(meta['og:site_name'], meta['application-name']),
    source: 'meta',
  };
}

function extractFromDomHints(html) {
  const titleHtml =
    html.match(
      /<(?:h1)[^>]*class=["'][^"']*\bjob__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    )?.[1] ||
    html.match(/<(?:h1)[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    '';

  const companyHtml =
    html.match(
      /itemprop=["']hiringOrganization["'][^>]*>[\s\S]*?itemprop=["']name["'][^>]*>([\s\S]*?)<\//i,
    )?.[1] ||
    html.match(
      /itemprop=["']hiringOrganization["'][^>]*content=["']([^"']+)["']/i,
    )?.[1] ||
    html.match(
      /<(?:div|span|p)[^>]*class=["'][^"']*\bcompany[-_]?name\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
    )?.[1] ||
    '';

  return {
    ...EMPTY_JOB,
    job_title: htmlToText(titleHtml),
    company_name: htmlToText(companyHtml),
    source: 'dom',
  };
}

function formatJsonLdLocation(location) {
  if (!location) return '';
  const items = Array.isArray(location) ? location : [location];
  const parts = items
    .map((item) => {
      const address = item?.address || item;
      if (typeof address === 'string') return address;
      return [
        address?.addressLocality,
        address?.addressRegion,
        address?.addressCountry,
      ]
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean);
  return [...new Set(parts)].join('; ');
}

function formatJsonLdSalary(salary) {
  if (!salary) return '';
  if (typeof salary === 'string' || typeof salary === 'number') return String(salary);
  const value = salary.value || salary;
  const currency = salary.currency || value.currency || 'USD';
  const min = value.minValue ?? value.value;
  const max = value.maxValue;
  const unit = String(value.unitText || salary.unitText || '').toLowerCase();
  const unitLabel =
    unit.includes('year') || unit === 'year'
      ? '/yr'
      : unit.includes('hour')
        ? '/hr'
        : unit.includes('month')
          ? '/mo'
          : '';
  if (min != null && max != null) {
    return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}${unitLabel}`;
  }
  if (min != null) return `${formatMoney(min, currency)}${unitLabel}`;
  return '';
}

function formatSalaryRange(min, max, currency = 'USD') {
  if (min == null && max == null) return '';
  if (min != null && max != null) {
    return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}/yr`;
  }
  return `${formatMoney(min ?? max, currency)}/yr`;
}

function formatMoney(amount, currency = 'USD') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  if (n >= 1000) {
    const compact =
      n % 1000 === 0 ? `${Math.round(n / 1000)}K` : `${(n / 1000).toFixed(1)}K`;
    return currency === 'USD' ? `$${compact}` : `${compact} ${currency}`;
  }
  return currency === 'USD' ? `$${n}` : `${n} ${currency}`;
}

function formatWorkSetup(jobLocationType, applicantLocationRequirements) {
  const raw = firstNonEmpty(
    asText(jobLocationType),
    asText(applicantLocationRequirements?.name),
    asText(applicantLocationRequirements),
  );
  if (!raw) return '';
  if (/telecommute|remote/i.test(raw)) return 'Remote';
  if (/hybrid/i.test(raw)) return 'Hybrid';
  if (/onsite|on-site|office/i.test(raw)) return 'Onsite';
  return raw.replace(/^https?:\/\/schema\.org\//i, '');
}

function formatYearsExperience(years) {
  if (years == null || years === '') return '';
  const n = Number(years);
  if (!Number.isFinite(n)) return String(years);
  return `${n}+ years`;
}

function companyFromTitle(title) {
  const match = String(title || '').match(/\b(?:at|@)\s+(.+?)(?:\s*[|\-–].*)?$/i);
  return match ? match[1].trim() : '';
}

function companyFromPath(pageUrl) {
  try {
    const url = new URL(pageUrl);
    if (!/greenhouse\.io$/i.test(url.hostname)) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    const board = parts[0] && parts[0] !== 'embed' ? parts[0] : '';
    if (!board || ['jobs', 'job', 'embed'].includes(board)) return '';
    return board
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

function stripCompanySuffix(title, company) {
  if (!title || !company) return title;
  const re = new RegExp(
    `\\s+(?:at|@)\\s+${escapeRegExp(company)}(?:\\s*[|\\-–].*)?$`,
    'i',
  );
  return title.replace(re, '').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function guessCompanyFromUrl(pageUrl) {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    const base = host.split('.')[0] || '';
    if (
      !base ||
      [
        'jobs',
        'careers',
        'www',
        'app',
        'boards',
        'job-boards',
        'greenhouse',
        'jobright',
      ].includes(base)
    ) {
      return '';
    }
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return '';
  }
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && value.name) return String(value.name).trim();
  return '';
}

function asStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') {
              return asText(item.text || item.name || item.skill || item.description);
            }
            return asText(item);
          })
          .filter(Boolean),
      ),
    ];
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : asText(value);
    if (text) return text;
  }
  return '';
}

function htmlToText(input) {
  return decodeEntities(
    String(input || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<(h[1-4])[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(Number.parseInt(n, 16)),
    );
}
