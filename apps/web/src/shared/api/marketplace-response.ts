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
    integer(value.leadDays) &&
    (value.dispatchWeekday === undefined ||
      (integer(value.dispatchWeekday) && value.dispatchWeekday <= 6))
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
function providerPlan(value: unknown) {
  return (
    record(value) &&
    provider(value.provider) &&
    quantity(value.averageDailyUnits) &&
    quantity(value.expectedSalesUnits30) &&
    typeof value.salesForecastKnown === "boolean" &&
    [value.targetUnits, value.dispatchUnits, value.dispatchBoxes].every(
      integer,
    ) &&
    [value.marketplaceUnits, value.inTransitUnits].every(
      (n) => n === null || integer(n),
    ) &&
    typeof value.dataComplete === "boolean" &&
    text(value.methodLabel) &&
    text(value.confidenceLabel) &&
    typeof value.scenario === "boolean"
  );
}
function weeklyDispatch(value: unknown) {
  return (
    record(value) &&
    text(value.date) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    timestamp(value.date) &&
    integer(value.boxes) &&
    integer(value.units) &&
    Array.isArray(value.providers) &&
    value.providers.every(
      (p) =>
        record(p) &&
        provider(p.provider) &&
        integer(p.boxes) &&
        integer(p.units),
    )
  );
}
function weeklySale(value: unknown) {
  return (
    record(value) &&
    text(value.from) &&
    timestamp(value.from) &&
    text(value.to) &&
    timestamp(value.to) &&
    quantity(value.units) &&
    Array.isArray(value.providers) &&
    value.providers.every(
      (p) =>
        record(p) &&
        provider(p.provider) &&
        quantity(p.units) &&
        typeof p.known === "boolean",
    )
  );
}
function planRow(value: unknown) {
  if (!record(value)) return false;
  return (
    quantity(value.expectedSalesUnits30) &&
    typeof value.salesForecastKnown === "boolean" &&
    Array.isArray(value.weeklySales) &&
    value.weeklySales.every(weeklySale) &&
    Array.isArray(value.weeklyDispatches) &&
    value.weeklyDispatches.every(weeklyDispatch) &&
    [
      value.monthlyOutboundBoxes,
      value.monthlyOutboundUnits,
      value.localAfterPlannedDispatchUnits,
      value.monthlyDispatchShortageUnits,
    ].every(integer) &&
    Array.isArray(value.providers) &&
    value.providers.every(providerPlan) &&
    [
      value.outboundBoxes,
      value.outboundUnits,
      value.newOutboundBoxes,
      value.newOutboundUnits,
      value.localAfterDispatchUnits,
      value.dispatchShortageUnits,
      value.assemblyShortageUnits,
      value.localAfterAssemblyUnits,
      value.backlogBoxes,
      value.backlogUnits,
    ].every(integer) &&
    (value.backlogRank === null ||
      (integer(value.backlogRank) && value.backlogRank > 0)) &&
    typeof value.backlogCapacityKnown === "boolean" &&
    typeof value.backlogCanCreate === "boolean" &&
    text(value.backlogReason) &&
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
function plan(value: unknown): value is MarketplaceOverviewDto["plan"] {
  return (
    record(value) &&
    integer(value.preparationDays) &&
    value.preparationDays > 0 &&
    text(value.preparationThrough) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.preparationThrough) &&
    timestamp(value.preparationThrough) &&
    timestamp(value.generatedAt) &&
    text(value.dispatchDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.dispatchDate) &&
    timestamp(value.dispatchDate) &&
    [value.leadDays, value.horizonDays, value.safetyDays].every(integer) &&
    text(value.backlogMessage) &&
    Array.isArray(value.rows) &&
    value.rows.every(planRow) &&
    strings(value.warnings)
  );
}
function planStatus(value: unknown) {
  return (
    record(value) &&
    ["current", "refreshing", "previous", "unavailable"].includes(
      String(value.state),
    ) &&
    nullableTimestamp(value.calculatedAt) &&
    nullableTimestamp(value.dataUpdatedAt) &&
    nullableTimestamp(value.salesThrough) &&
    text(value.message)
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
    plan(value.plan) &&
    (value.previousPlan === null ||
      (plan(value.previousPlan) &&
        value.previousPlan.rows.every(
          (row) => row.canCreate === false && row.backlogCanCreate === false,
        ))) &&
    planStatus(value.planStatus)
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
