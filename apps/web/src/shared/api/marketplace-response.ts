import type {
  MarketplaceOverviewDto,
  MarketplaceTaskResultDto,
} from "./generated/model";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text);
const provider = (value: unknown) =>
  value === "wildberries" || value === "ozon";
const quantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number =>
  quantity(value) && Number.isSafeInteger(value);
const timestamp = (value: unknown) =>
  text(value) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) =>
  value === null || timestamp(value);
function connection(value: unknown) {
  return (
    record(value) &&
    provider(value.provider) &&
    typeof value.configured === "boolean" &&
    typeof value.enabled === "boolean" &&
    nullableText(value.clientId) &&
    ["never", "running", "success", "failed", "partial"].includes(
      String(value.syncStatus),
    ) &&
    nullableTimestamp(value.lastSuccessAt) &&
    nullableTimestamp(value.lastAttemptAt) &&
    nullableText(value.message) &&
    strings(value.warnings)
  );
}
function product(value: unknown) {
  return (
    record(value) &&
    provider(value.provider) &&
    text(value.externalId) &&
    nullableText(value.offerId) &&
    text(value.name) &&
    strings(value.barcodes) &&
    nullableText(value.skuId) &&
    integer(value.unitsPerItem) &&
    value.unitsPerItem > 0 &&
    nullableText(value.suggestedSkuId)
  );
}
function inboundSource(value: unknown) {
  return (
    record(value) &&
    provider(value.provider) &&
    (value.units === null || integer(value.units)) &&
    ["wb_supplies", "ozon_analytics", "legacy", "unknown"].includes(
      String(value.source),
    ) &&
    nullableTimestamp(value.asOf) &&
    integer(value.supplyCount) &&
    strings(value.warnings)
  );
}
function supplyItem(value: unknown) {
  return (
    record(value) &&
    text(value.externalId) &&
    text(value.name) &&
    nullableText(value.skuId) &&
    (value.plannedUnits === null || integer(value.plannedUnits)) &&
    [value.acceptedUnits, value.readyUnits, value.pendingUnits].every(
      (item) => item === null || integer(item),
    )
  );
}
function supply(value: unknown) {
  return (
    record(value) &&
    provider(value.provider) &&
    text(value.id) &&
    text(value.statusCode) &&
    text(value.statusLabel) &&
    [value.expectedAt, value.receivedAt, value.updatedAt].every(
      nullableTimestamp,
    ) &&
    ["document", "analytics", "excluded", "review"].includes(
      String(value.calculation),
    ) &&
    strings(value.warnings) &&
    Array.isArray(value.items) &&
    value.items.every(supplyItem)
  );
}
function settings(value: unknown) {
  return (
    record(value) &&
    integer(value.historyDays) &&
    value.historyDays > 0 &&
    integer(value.horizonDays) &&
    value.horizonDays > 0 &&
    integer(value.safetyDays) &&
    integer(value.leadDays)
  );
}
function advice(value: unknown) {
  return (
    record(value) &&
    ["ready", "covered", "raw_shortage", "review"].includes(
      String(value.state),
    ) &&
    text(value.message) &&
    ["create", "receiving", "integrations", "transit", "none"].includes(
      String(value.action),
    )
  );
}
function planningStock(value: unknown) {
  return (
    record(value) &&
    text(value.skuId) &&
    typeof value.enabled === "boolean" &&
    (value.units === null || integer(value.units)) &&
    ["exact", "approximate"].includes(String(value.accuracy)) &&
    text(value.note) &&
    timestamp(value.countedAt) &&
    integer(value.unitsPerBoxAtCount) &&
    value.unitsPerBoxAtCount > 0 &&
    integer(value.trackedUnitsAtCount) &&
    integer(value.revision)
  );
}
function planRow(value: unknown) {
  if (!record(value)) return false;
  return (
    advice(value.advice) &&
    typeof value.dataComplete === "boolean" &&
    integer(value.unregisteredUnits) &&
    nullableTimestamp(value.stockConfirmedAt) &&
    typeof value.stockEstimated === "boolean" &&
    text(value.skuId) &&
    text(value.skuName) &&
    integer(value.unitsPerBox) &&
    value.unitsPerBox > 0 &&
    quantity(value.averageDailyUnits) &&
    [
      value.targetUnits,
      value.marketplaceUnits,
      value.readyUnits,
      value.shippingReadyUnits,
      value.shipmentReservedUnits,
      value.openTaskUnits,
      value.rawAvailableUnits,
      value.recommendedUnits,
      value.recommendedBoxes,
    ].every(integer) &&
    (value.inTransitUnits === null || integer(value.inTransitUnits)) &&
    ["api", "manual", "unknown"].includes(String(value.inboundSource)) &&
    Array.isArray(value.inboundSources) &&
    value.inboundSources.every(inboundSource) &&
    typeof value.canCreate === "boolean" &&
    strings(value.blockers) &&
    strings(value.warnings) &&
    text(value.proposalHash)
  );
}
export function isMarketplaceOverviewResponse(
  value: unknown,
): value is MarketplaceOverviewDto {
  return (
    record(value) &&
    Array.isArray(value.connections) &&
    value.connections.every(connection) &&
    Array.isArray(value.products) &&
    value.products.every(product) &&
    Array.isArray(value.supplies) &&
    value.supplies.every(supply) &&
    settings(value.settings) &&
    Array.isArray(value.planningStock) &&
    value.planningStock.every(planningStock) &&
    record(value.plan) &&
    timestamp(value.plan.generatedAt) &&
    Array.isArray(value.plan.rows) &&
    value.plan.rows.every(planRow) &&
    strings(value.plan.warnings)
  );
}
export function isMarketplaceTaskResponse(
  value: unknown,
): value is MarketplaceTaskResultDto {
  return (
    record(value) &&
    text(value.taskId) &&
    !!value.taskId &&
    isMarketplaceOverviewResponse(value.overview)
  );
}
