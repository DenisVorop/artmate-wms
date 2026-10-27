const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const quantity = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown) => typeof value === "string" && !!value.trim();
const pressure = (value: unknown) =>
  ["normal", "near_full", "full", "unavailable"].includes(value as string);

/** A settings acknowledgement is not a warehouse stock-command response. */
export function isWorkAutomationResponse(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.enabled === "boolean" &&
    (value.lastCheckedAt === null ||
      (text(value.lastCheckedAt) &&
        Number.isFinite(Date.parse(value.lastCheckedAt as string)))) &&
    quantity(value.queuedAssemblyTasks) &&
    quantity(value.queuedPutawayTasks) &&
    quantity(value.assemblyBoxes) &&
    (value.assemblyCapacityBoxes === null ||
      quantity(value.assemblyCapacityBoxes)) &&
    pressure(value.pressure) &&
    text(value.message) &&
    Array.isArray(value.blockers) &&
    value.blockers.every(text)
  );
}

/** Optional additive workspace field; old command replays may omit it. */
export function isAssemblyPressure(value: unknown): boolean {
  return (
    record(value) &&
    pressure(value.level) &&
    (value.locationId === null || text(value.locationId)) &&
    (value.palletId === null || text(value.palletId)) &&
    quantity(value.boxes) &&
    quantity(value.committedBoxes) &&
    (value.capacityBoxes === null || quantity(value.capacityBoxes)) &&
    text(value.message)
  );
}
