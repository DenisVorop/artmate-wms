const dayMs = 86_400_000;

/** Date-only values deliberately stay date-only in API queries. */
export function moscowDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isWorkforceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function workforcePeriod(days: 1 | 7 | 30 = 1, now = new Date()) {
  const to = moscowDay(now);
  const from = new Date(
    new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * dayMs,
  )
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

export function workforcePeriodDays(from: string, to: string): number {
  return (
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      dayMs +
    1
  );
}
