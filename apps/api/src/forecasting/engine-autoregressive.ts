import {
  baselineFromObservations,
  demandObservationCap,
  type DemandObservation,
} from "./demand-baseline";
const DAY = 86_400_000;
const mean = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
const clamp = (value: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, value));
function features(
  byDay: Map<number, number>,
  day: number,
  origin: number,
): number[] | null {
  const lag1 = byDay.get(day - 1),
    lag7 = byDay.get(day - 7),
    lag14 = byDay.get(day - 14);
  if (lag1 === undefined || lag7 === undefined || lag14 === undefined)
    return null;
  const rolling = (days: number) =>
    Array.from({ length: days }, (_, i) => byDay.get(day - i - 1)).filter(
      (n): n is number => n !== undefined,
    );
  const week = rolling(7),
    month = rolling(28);
  if (week.length < 5 || month.length < 20) return null;
  const weekday = new Date(day * DAY).getUTCDay();
  return [
    1,
    Math.log1p(lag1),
    Math.log1p(lag7),
    Math.log1p(lag14),
    Math.log1p(mean(week)),
    Math.log1p(mean(month)),
    (day - origin) / 180,
    ...Array.from({ length: 6 }, (_, i) => (weekday === i + 1 ? 1 : 0)),
  ];
}
function solve(rows: number[][], targets: number[]): number[] | null {
  const width = rows[0].length,
    matrix = Array.from({ length: width }, () =>
      Array<number>(width + 1).fill(0),
    );
  rows.forEach((row, k) =>
    row.forEach((a, i) => {
      matrix[i][width] += a * targets[k];
      row.forEach((b, j) => {
        matrix[i][j] += a * b;
      });
    }),
  );
  for (let i = 1; i < width; i++) matrix[i][i] += 2;
  for (let i = 0; i < width; i++) {
    let pivot = i;
    for (let j = i + 1; j < width; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const divisor = matrix[i][i];
    if (Math.abs(divisor) < 1e-10) return null;
    for (let j = i; j <= width; j++) matrix[i][j] /= divisor;
    for (let r = 0; r < width; r++)
      if (r !== i) {
        const factor = matrix[r][i];
        for (let j = i; j <= width; j++) matrix[r][j] -= factor * matrix[i][j];
      }
  }
  const result = matrix.map((r) => r[width]);
  return result.every(Number.isFinite) ? result : null;
}
const dot = (row: number[], coefficients: number[]) =>
  row.reduce((sum, n, i) => sum + n * coefficients[i], 0);
/** Locally trained regularized autoregression, distinct from annual calendar ridge. */
export function fitAutoregressive(
  values: DemandObservation[],
  asOf: number,
  horizon: number,
  baselineHistoryDays: number,
): { values: number[] | null; reason: string | null } {
  // Every known observation since trading began contributes; future values never enter fitting.
  const train = values.filter((p) => p.day <= asOf);
  if (train.length < 70)
    return {
      values: null,
      reason: "Для обучаемой модели нужно не менее 70 известных дней спроса.",
    };
  const cap = demandObservationCap(train.map((p) => p.units)),
    byDay = new Map(train.map((p) => [p.day, Math.min(p.units, cap)]));
  const origin = train[0].day,
    rows: number[][] = [],
    targets: number[] = [];
  for (const point of train) {
    const row = features(byDay, point.day, origin);
    if (row) {
      rows.push(row);
      targets.push(Math.log1p(Math.min(point.units, cap)));
    }
  }
  if (rows.length < 42)
    return {
      values: null,
      reason:
        "В истории слишком много пропусков для обучения по предыдущим дням.",
    };
  const coefficients = solve(rows, targets);
  if (!coefficients)
    return {
      values: null,
      reason: "Обучаемую модель не удалось устойчиво оценить.",
    };
  const residual = clamp(
    mean(
      rows.map((row, i) =>
        Math.exp(clamp(targets[i] - dot(row, coefficients), -5, 5)),
      ),
    ),
    0.5,
    2,
  );
  const fallback = baselineFromObservations(
    train,
    asOf,
    horizon,
    baselineHistoryDays,
  ).dailyForecast;
  const forecast: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const day = asOf + i + 1,
      row = features(byDay, day, origin);
    if (!row)
      return {
        values: null,
        reason: "Для начала прогноза не хватает последних наблюдений спроса.",
      };
    // Learned trend extrapolates for at most one month; recursive lags contain predictions only.
    row[6] = (asOf - origin + 30 * (1 - Math.exp(-(i + 1) / 30))) / 180;
    const predicted = clamp(
      Math.exp(clamp(dot(row, coefficients), -20, 20)) * residual - 1,
      0,
      cap,
    );
    const weight = Math.exp(-i / 180),
      units = predicted * weight + fallback[i].units * (1 - weight);
    byDay.set(day, units);
    forecast.push(units);
  }
  return { values: forecast, reason: null };
}
