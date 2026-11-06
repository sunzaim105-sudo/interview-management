export function formatMailDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatMailDateLong(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const absolute = date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return `${absolute} (just now)`;
  if (mins < 60) return `${absolute} (${mins} minute${mins === 1 ? '' : 's'} ago)`;
  const hours = Math.round(mins / 60);
  if (hours < 48) {
    return `${absolute} (${hours} hour${hours === 1 ? '' : 's'} ago)`;
  }
  return absolute;
}

export function senderLabel(from = '') {
  const name = String(from).replace(/<[^>]+>/, '').trim();
  return name || from || 'Unknown';
}

export function senderEmail(from = '') {
  const match = String(from).match(/<([^>]+)>/);
  if (match?.[1]) return match[1];
  if (String(from).includes('@')) return String(from).trim();
  return '';
}

export function senderInitials(from = '') {
  const name = senderLabel(from)
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim();
  if (!name) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
