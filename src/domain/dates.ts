export function localDateInTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function addLocalDays(localDate: string, amount: number): string {
  const date = new Date(`${localDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function addLocalMonths(localDate: string, amount: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const first = new Date(Date.UTC(year!, month! - 1 + amount, 1, 12));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(day!, lastDay));
  return first.toISOString().slice(0, 10);
}

export function startOfLocalWeek(localDate: string): string {
  const day = new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addLocalDays(localDate, -daysSinceMonday);
}

export function nextLocalWeekStart(localDate: string): string {
  return addLocalDays(startOfLocalWeek(localDate), 7);
}

export function formatLocalDate(localDate: string, timezone: string, options: Intl.DateTimeFormatOptions) {
  // A local calendar date is already the user's date. Formatting its UTC-noon
  // anchor in an account timezone can shift it into the next/previous day.
  void timezone;
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${localDate}T12:00:00.000Z`));
}

export function isValidLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(12, 0, 0, 0);
  return parsed.toISOString().slice(0, 10) === value;
}

export function effectiveTarget<T extends { effective_from: string }>(versions: T[], localDate: string): T | null {
  return versions.filter((version) => version.effective_from <= localDate)
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}
