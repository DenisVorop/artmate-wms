/** Deterministic calendar covariates known at every forecast origin.
 * Fixed Russian holiday dates: https://www.cbr.ru/other/holidays/.
 * Transfers, marketplace closures, promotions and future decisions are deliberately
 * absent: a calendar event is a predictor, never a forced zero-demand day.
 */
export const CALENDAR_FEATURE_VERSION = "ru-calendar-v1";
const DAY = 86_400_000;
const HOLIDAYS = [
  ["new_year", 0, 1],
  ["defender", 1, 23],
  ["women", 2, 8],
  ["spring", 4, 1],
  ["victory", 4, 9],
  ["russia", 5, 12],
  ["unity", 10, 4],
] as const;
export function knownCalendarFeatures(day: number): Record<string, number> {
  const date = new Date(day * DAY);
  if (!Number.isInteger(day) || !Number.isFinite(date.getTime()))
    throw new Error("Calendar features require an integer UTC calendar day");
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth(),
    start = Date.UTC(year, 0, 1) / DAY,
    end = Date.UTC(year + 1, 0, 1) / DAY,
    phase = (day - start) / (end - start);
  // ISO week uses Thursday to determine the year at January/December boundaries.
  const thursday = day + 4 - (date.getUTCDay() || 7),
    weekYear = new Date(thursday * DAY).getUTCFullYear(),
    week = Math.ceil((thursday - Date.UTC(weekYear, 0, 1) / DAY + 1) / 7);
  const result: Record<string, number> = {};
  for (let harmonic = 1; harmonic <= 4; harmonic++) {
    result[`annual_sin_${harmonic}`] = Math.sin(2 * Math.PI * harmonic * phase);
    result[`annual_cos_${harmonic}`] = Math.cos(2 * Math.PI * harmonic * phase);
  }
  for (let weekday = 1; weekday <= 6; weekday++)
    result[`weekday_${weekday}`] = date.getUTCDay() === weekday ? 1 : 0;
  // January/Sunday are reference categories; coefficients are learned, not uplifts.
  for (let m = 1; m <= 11; m++) result[`month_${m + 1}`] = month === m ? 1 : 0;
  result.week_of_year_sin = Math.sin((2 * Math.PI * (week - 1)) / 53);
  result.week_of_year_cos = Math.cos((2 * Math.PI * (week - 1)) / 53);
  for (const [name, holidayMonth, holidayDate] of HOLIDAYS) {
    const next = [year, year + 1]
      .map((y) => Date.UTC(y, holidayMonth, holidayDate) / DAY - day)
      .find((distance) => distance >= 0)!;
    result[`holiday_${name}`] =
      name === "new_year"
        ? month === 0 && date.getUTCDate() <= 8
          ? 1
          : 0
        : next === 0
          ? 1
          : 0;
    result[`lead_${name}_14`] = next <= 14 ? 1 - next / 15 : 0;
  }
  const toNewYear = end - day;
  result.new_year_lead_60 = toNewYear <= 60 ? 1 - toNewYear / 61 : 0;
  result.new_year_lead_30 = toNewYear <= 30 ? 1 : 0;
  result.new_year_lead_14 = toNewYear <= 14 ? 1 : 0;
  return result;
}
export function calendarPredictors(day: number): number[] {
  return Object.values(knownCalendarFeatures(day));
}
export function calendarFeatures(day: number, origin: number): number[] {
  return [1, (day - origin) / 365, ...calendarPredictors(day)];
}
