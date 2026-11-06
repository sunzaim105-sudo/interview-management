import Holidays from 'date-holidays';

function buildCountryList() {
  try {
    const hd = new Holidays();
    const map = hd.getCountries('en') || {};
    return Object.entries(map)
      .map(([code, label]) => ({ code, label: String(label) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [
      { code: 'US', label: 'United States' },
      { code: 'PH', label: 'Philippines' },
    ];
  }
}

export const COUNTRIES = buildCountryList();

export const DATE_FORMATS = [
  { id: 'MDY', label: '12/31/2026' },
  { id: 'DMY', label: '31/12/2026' },
  { id: 'YMD', label: '2026-12-31' },
];

export const TIME_FORMATS = [
  { id: '12h', label: '1:00pm' },
  { id: '24h', label: '13:00' },
];

export const NOTIFICATION_LEAD_OPTIONS = [
  { id: 10, label: '10 min' },
  { id: 20, label: '20 min' },
  { id: 30, label: '30 min' },
];

const FALLBACK_TIME_ZONES = [
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Halifax',
  'America/Sao_Paulo',
  'Atlantic/Azores',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Athens',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function getOffsetMinutes(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
    }).formatToParts(date);
    const raw = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
    const match = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * (hours * 60 + minutes);
  } catch {
    return 0;
  }
}

function formatGmtOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `GMT${sign}${pad(hours)}:${pad(minutes)}`;
}

function friendlyZoneName(timeZoneId) {
  return String(timeZoneId || '')
    .split('/')
    .map((part) => part.replace(/_/g, ' '))
    .join(' / ');
}

export function buildTimeZones(referenceDate = new Date()) {
  let ids = FALLBACK_TIME_ZONES;
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      ids = Intl.supportedValuesOf('timeZone');
    }
  } catch {
    ids = FALLBACK_TIME_ZONES;
  }

  return ids
    .map((id) => {
      const offsetMinutes = getOffsetMinutes(referenceDate, id);
      return {
        id,
        offsetMinutes,
        label: `(${formatGmtOffset(offsetMinutes)}) ${friendlyZoneName(id)}`,
      };
    })
    .sort(
      (a, b) =>
        a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label),
    );
}

/** Full timezone catalog (Google Calendar–style coverage via IANA zones). */
export const TIME_ZONES = buildTimeZones();

export const DEFAULT_SETTINGS = {
  country: 'US',
  dateFormat: 'MDY',
  timeFormat: '12h',
  timeZone:
    (typeof Intl !== 'undefined' &&
      Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    'America/New_York',
  notificationLeadMinutes: 10,
};

export function formatMDY(date) {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`;
}

export function formatDMY(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatYMD(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateBySetting(date, dateFormat) {
  if (dateFormat === 'DMY') return formatDMY(date);
  if (dateFormat === 'YMD') return formatYMD(date);
  return formatMDY(date);
}

export function formatTimeBySetting(date, timeFormat, timeZone) {
  const opts =
    timeFormat === '24h'
      ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }
      : { hour: 'numeric', minute: '2-digit', hour12: true, timeZone };

  return new Intl.DateTimeFormat('en-US', opts)
    .format(date)
    .toLowerCase()
    .replace(/\s/g, '');
}

export function formatDisplayDate(date, dateFormat, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const y = get('year');
  const m = get('month');
  const d = get('day');

  if (dateFormat === 'DMY') return `${d}/${m}/${y}`;
  if (dateFormat === 'YMD') return `${y}-${m}-${d}`;
  return `${m}/${d}/${y}`;
}

export function getTimeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour') === '24' ? '0' : get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    offsetLabel: (get('timeZoneName') || 'GMT').replace('GMT', 'GMT'),
  };
}

export function getGmtLabel(date, timeZone) {
  const label = getTimeZoneParts(date, timeZone).offsetLabel || 'GMT';
  return label.replace('UTC', 'GMT');
}

/** Convert a wall-clock date+time in `timeZone` into a UTC Date. */
export function zonedWallTimeToUtc(dateStr, timeStr, timeZone) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const [hour, minute] = String(timeStr).split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);

  let guess = desired;
  for (let i = 0; i < 3; i += 1) {
    const parts = getTimeZoneParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second || 0,
    );
    guess += desired - asUtc;
  }

  return new Date(guess);
}

/** Convert a UTC Date into wall-clock date/time strings in `timeZone`. */
export function utcToZonedWallTime(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

export function loadCalendarSettings() {
  try {
    const raw = localStorage.getItem('calid.calendarSettings');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const next = { ...DEFAULT_SETTINGS, ...parsed };
    const lead = Number(next.notificationLeadMinutes);
    next.notificationLeadMinutes = [10, 20, 30].includes(lead) ? lead : 10;
    if (!TIME_ZONES.some((zone) => zone.id === next.timeZone)) {
      next.timeZone = DEFAULT_SETTINGS.timeZone;
    }
    return next;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveCalendarSettings(settings) {
  localStorage.setItem('calid.calendarSettings', JSON.stringify(settings));
}
