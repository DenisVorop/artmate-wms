import type {
  ForecastOverviewDto,
  ForecastHistoryOverviewDto,
  ForecastHistorySeriesDto,
} from "./generated/model";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const bool = (v: unknown) => typeof v === "boolean";
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const quantity = (v: unknown): v is number => number(v) && v >= 0;
const integer = (v: unknown) => quantity(v) && Number.isSafeInteger(v);
const provider = (v: unknown) => v === "ozon" || v === "wildberries";
const date = (v: unknown) =>
  text(v) &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const nullableDate = (v: unknown) => v === null || date(v);
const nullableQuantity = (v: unknown) => v === null || quantity(v);
const array = (v: unknown, guard: (item: unknown) => boolean) =>
  Array.isArray(v) && v.every(guard);
function candidate(v: unknown) {
  return (
    record(v) &&
    text(v.model) &&
    text(v.label) &&
    bool(v.eligible) &&
    nullableText(v.reason) &&
    nullableQuantity(v.mae) &&
    nullableQuantity(v.wape) &&
    (v.bias === null || number(v.bias)) &&
    integer(v.folds)
  );
}
function chartPoint(v: unknown) {
  return (
    record(v) &&
    date(v.date) &&
    nullableQuantity(v.actual) &&
    nullableQuantity(v.predicted)
  );
}
function source(v: unknown) {
  return (
    record(v) &&
    provider(v.provider) &&
    text(v.metricLabel) &&
    text(v.modelLabel) &&
    quantity(v.predictedUnits) &&
    integer(v.historyDays) &&
    array(v.candidates, candidate) &&
    array(v.points, chartPoint)
  );
}
function row(v: unknown) {
  return (
    record(v) &&
    text(v.skuId) &&
    text(v.skuName) &&
    integer(v.minimumBoxes) &&
    bool(v.seasonalityEnabled) &&
    quantity(v.targetUnits) &&
    bool(v.seasonalityApplied) &&
    text(v.methodLabel) &&
    text(v.confidenceLabel) &&
    text(v.message) &&
    nullableDate(v.historyFrom) &&
    nullableDate(v.historyTo) &&
    integer(v.knownDays) &&
    array(v.sources, source)
  );
}
export function isForecastOverviewResponse(
  v: unknown,
): v is ForecastOverviewDto {
  return (
    record(v) &&
    bool(v.ready) &&
    bool(v.computing) &&
    text(v.message) &&
    (v.generatedAt === null ||
      (text(v.generatedAt) && Number.isFinite(Date.parse(v.generatedAt)))) &&
    array(v.rows, row)
  );
}
function historyProvider(v: unknown) {
  return (
    record(v) &&
    provider(v.provider) &&
    bool(v.financeConfigured) &&
    nullableDate(v.from) &&
    nullableDate(v.to) &&
    integer(v.knownDays) &&
    integer(v.products) &&
    text(v.message)
  );
}
function historyJob(v: unknown) {
  return (
    record(v) &&
    text(v.id) &&
    provider(v.provider) &&
    date(v.from) &&
    date(v.to) &&
    (v.loadedThrough === "" || date(v.loadedThrough)) &&
    [
      "queued",
      "running",
      "complete",
      "permission_required",
      "paused",
      "failed",
    ].includes(String(v.status)) &&
    text(v.message) &&
    integer(v.pages)
  );
}
export function isForecastHistoryOverviewResponse(
  v: unknown,
): v is ForecastHistoryOverviewDto {
  return (
    record(v) &&
    array(v.providers, historyProvider) &&
    array(v.jobs, historyJob)
  );
}
function series(v: unknown) {
  return (
    record(v) &&
    text(v.skuId) &&
    text(v.storeId) &&
    provider(v.provider) &&
    text(v.externalId) &&
    ["ordered", "cancelled", "sold", "returned"].includes(String(v.metric)) &&
    text(v.source) &&
    array(
      v.points,
      (p) =>
        record(p) &&
        date(p.date) &&
        nullableQuantity(p.units) &&
        ["available", "out_of_stock", "unknown"].includes(
          String(p.availability),
        ),
    )
  );
}
export function isForecastHistorySeriesResponse(
  v: unknown,
): v is ForecastHistorySeriesDto[] {
  return array(v, series);
}
