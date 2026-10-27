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

export function startOfLocalWeek(localDate: string): string {
  const day = new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addLocalDays(localDate, -daysSinceMonday);
}

export function nextLocalWeekStart(localDate: string): string {
  return addLocalDays(startOfLocalWeek(localDate), 7);
}

export function formatLocalDate(localDate: string, timezone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone }).format(new Date(`${localDate}T12:00:00.000Z`));
}

export function effectiveTarget<T extends { effective_from: string }>(versions: T[], localDate: string): T | null {
  return versions.filter((version) => version.effective_from <= localDate)
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null;
}
