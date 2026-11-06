import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE =
  /(?:\+?\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s().-]*)?\d{3}[\s().-]*\d{4}\b/;
const LOCATION_RE =
  /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.']+){0,3}),\s*([A-Z]{2}|[A-Z][a-zA-Z]+)\b/;
const TITLE_HINT_RE =
  /\b(engineer|developer|manager|designer|analyst|consultant|director|lead|architect|specialist|recruiter|coordinator|scientist|founder|ceo|cto|intern|assistant|officer)\b/i;

/**
 * Parse an uploaded resume and extract team-member fields.
 * Returns only structured fields — never the full resume body.
 */
export async function parseResumeFile({
  filename = '',
  contentType = '',
  dataBase64 = '',
}) {
  if (!dataBase64) throw new Error('Resume file data is required.');

  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) throw new Error('Resume file is empty.');
  if (buffer.length > MAX_RESUME_BYTES) {
    throw new Error('Resume must be 10MB or smaller.');
  }

  const kind = detectKind(filename, contentType);
  const text = await extractText(buffer, kind);
  if (!text.trim()) {
    throw new Error('Could not read text from that resume.');
  }

  const fields = extractMemberFields(text);
  if (!fields.name && !fields.email && !fields.phone_number) {
    throw new Error(
      'Could not find name, email, or phone in that resume. Fill the form manually.',
    );
  }

  return {
    ...fields,
    source: kind,
  };
}

export function extractMemberFields(rawText) {
  const text = normalizeResumeText(rawText);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const email = firstMatch(text, EMAIL_RE) || '';
  const phone_number = cleanPhone(firstMatch(text, PHONE_RE) || '');
  const location = extractLocation(lines, text);
  const name = extractName(lines, email);
  const professional_title = extractTitle(lines, name, email);

  return {
    name,
    professional_title,
    email,
    phone_number,
    location,
  };
}

function detectKind(filename, contentType) {
  const lowerName = String(filename || '').toLowerCase();
  const type = String(contentType || '').toLowerCase();

  if (lowerName.endsWith('.pdf') || type.includes('pdf')) return 'pdf';
  if (
    lowerName.endsWith('.docx') ||
    type.includes('wordprocessingml') ||
    type.includes('officedocument.wordprocessingml')
  ) {
    return 'docx';
  }
  if (lowerName.endsWith('.doc') || type.includes('msword')) {
    throw new Error('DOC files are not supported. Upload PDF, DOCX, or TXT.');
  }
  if (lowerName.endsWith('.txt') || type.includes('text/plain')) return 'txt';

  // Default by sniffing PDF header.
  return 'txt';
}

async function extractText(buffer, kind) {
  if (kind === 'pdf' || buffer.slice(0, 4).toString() === '%PDF') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return String(result?.text || '');
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return String(result?.value || '');
  }

  return buffer.toString('utf8');
}

function normalizeResumeText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function firstMatch(text, re) {
  const match = text.match(re);
  return match ? match[0].trim() : '';
}

function cleanPhone(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractName(lines, email) {
  for (const line of lines.slice(0, 12)) {
    if (!line || line === email) continue;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) continue;
    if (/linkedin|github|portfolio|http|www\./i.test(line)) continue;
    if (/^(resume|curriculum vitae|cv)\b/i.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    if (/^\d/.test(line)) continue;
    if (TITLE_HINT_RE.test(line) && /,| at | \| /.test(line)) continue;

    const words = line.split(/\s+/);
    if (words.length < 1 || words.length > 5) continue;
    if (words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word))) {
      return line.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return '';
}

function extractTitle(lines, name, email) {
  const start = Math.max(0, lines.findIndex((line) => line === name));
  const window = lines.slice(start, start + 8);

  for (const line of window) {
    if (!line || line === name || line === email) continue;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) continue;
    if (/linkedin|github|http|www\./i.test(line)) continue;
    if (LOCATION_RE.test(line)) continue;
    if (TITLE_HINT_RE.test(line) && line.length <= 80) {
      return line.replace(/\s*[|•].*$/, '').trim();
    }
  }

  // Fallback: "Name — Title" style on the same/nearby line.
  for (const line of window) {
    const parts = line.split(/\s+[|–—-]\s+/);
    if (parts.length >= 2 && TITLE_HINT_RE.test(parts[1])) {
      return parts[1].trim();
    }
  }

  return '';
}

function extractLocation(lines, text) {
  for (const line of lines.slice(0, 20)) {
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) continue;
    const match = line.match(LOCATION_RE);
    if (match) return match[0].trim();
  }

  const global = text.match(LOCATION_RE);
  return global ? global[0].trim() : '';
}
