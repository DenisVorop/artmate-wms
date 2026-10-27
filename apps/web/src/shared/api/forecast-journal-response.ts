import type {
  ForecastJournalListDto,
  ForecastJournalDetailDto,
} from "./generated/model";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const id = (v: unknown) => text(v) && /^[a-f0-9]{64}$/.test(v);
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const quantity = (v: unknown) => number(v) && v >= 0;
const integer = (v: unknown) => quantity(v) && Number.isSafeInteger(v);
const nullableQuantity = (v: unknown) => v === null || quantity(v);
const date = (v: unknown) =>
  text(v) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const timestamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
function summary(v: unknown) {
  return (
    record(v) &&
    id(v.id) &&
    timestamp(v.generatedAt) &&
    timestamp(v.publishedAt) &&
    date(v.asOf) &&
    text(v.modelVersion) &&
    integer(v.seriesCount) &&
    (v.from === null || date(v.from)) &&
    (v.to === null || date(v.to))
  );
}
export function isForecastJournalListResponse(
  v: unknown,
): v is ForecastJournalListDto {
  return (
    record(v) &&
    Array.isArray(v.runs) &&
    v.runs.every(summary) &&
    (v.nextCursor === null || id(v.nextCursor))
  );
}
function point(v: unknown) {
  return (
    record(v) &&
    date(v.date) &&
    quantity(v.predicted) &&
    quantity(v.basePredicted) &&
    quantity(v.factor) &&
    nullableQuantity(v.actual) &&
    ["pending", "unknown", "stockout", "same_day", "scored"].includes(
      String(v.status),
    )
  );
}
function row(v: unknown) {
  return (
    record(v) &&
    id(v.id) &&
    id(v.scopeKey) &&
    text(v.skuId) &&
    text(v.skuName) &&
    ["ozon", "wildberries"].includes(String(v.provider)) &&
    v.metric === "net_ordered" &&
    text(v.modelLabel) &&
    typeof v.scenario === "boolean" &&
    Array.isArray(v.points) &&
    v.points.every(point) &&
    quantity(v.comparablePredicted) &&
    quantity(v.actual) &&
    nullableQuantity(v.mae) &&
    nullableQuantity(v.wape) &&
    (v.bias === null || number(v.bias)) &&
    integer(v.scoredDays) &&
    integer(v.pendingDays) &&
    integer(v.unknownDays) &&
    integer(v.stockoutDays)
  );
}
export function isForecastJournalDetailResponse(
  v: unknown,
): v is ForecastJournalDetailDto {
  return (
    summary(v) &&
    record(v) &&
    date(v.evaluatedAsOf) &&
    Array.isArray(v.rows) &&
    v.rows.every(row)
  );
}
