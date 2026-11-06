/** First whitespace-separated token of a display name. */
export function firstName(fullName) {
  const text = String(fullName || '').trim();
  if (!text) return '';
  return text.split(/\s+/)[0];
}
