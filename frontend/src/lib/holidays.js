import Holidays from 'date-holidays';

const libCache = new Map();
const apiCache = new Map();

function getHolidayLib(countryCode) {
  if (!libCache.has(countryCode)) {
    libCache.set(countryCode, new Holidays(countryCode));
  }
  return libCache.get(countryCode);
}

function sameYmd(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fromLib(countryCode, startDate, endDate) {
  try {
    const hd = getHolidayLib(countryCode);
    const years = new Set([startDate.getFullYear(), endDate.getFullYear()]);
    const holidays = [];

    years.forEach((year) => {
      (hd.getHolidays(year) || []).forEach((item) => {
        if (item.type !== 'public') return;
        const date = new Date(item.date);
        if (date >= startDate && date <= endDate) {
          holidays.push({ date, name: item.name, source: 'local' });
        }
      });
    });

    return holidays;
  } catch {
    return [];
  }
}

async function fromNagerApi(countryCode, year) {
  const key = `${countryCode}-${year}`;
  if (apiCache.has(key)) return apiCache.get(key);

  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
    );
    if (!res.ok) {
      apiCache.set(key, []);
      return [];
    }
    const rows = await res.json();
    const mapped = (rows || []).map((row) => ({
      date: new Date(`${row.date}T00:00:00`),
      name: row.localName || row.name,
      source: 'nager',
    }));
    apiCache.set(key, mapped);
    return mapped;
  } catch {
    apiCache.set(key, []);
    return [];
  }
}

export function getHolidaysForRange(countryCode, startDate, endDate) {
  if (!countryCode) return [];
  return fromLib(countryCode, startDate, endDate);
}

export async function getHolidaysForRangeAsync(countryCode, startDate, endDate) {
  if (!countryCode) return [];

  const local = fromLib(countryCode, startDate, endDate);
  if (local.length) return local;

  const years = [...new Set([startDate.getFullYear(), endDate.getFullYear()])];
  const apiRows = (
    await Promise.all(years.map((year) => fromNagerApi(countryCode, year)))
  ).flat();

  return apiRows.filter((item) => item.date >= startDate && item.date <= endDate);
}

export function holidaysOnDay(holidays, day) {
  return holidays.filter((h) => sameYmd(h.date, day));
}
