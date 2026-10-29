/** Validate only the additive load envelope; historical snapshots may omit it. */
export function hasValidLoadedPalletDimensions(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const profile = value as Record<string, unknown>;
  return [
    ["loadWidthMm", "palletWidthMm"],
    ["loadDepthMm", "palletDepthMm"],
  ].every(([load, base]) => {
    const size = profile[load];
    if (size === undefined) return true;
    const foundation = profile[base];
    return (
      typeof size === "number" &&
      Number.isInteger(size) &&
      size >= 100 &&
      size <= 5000 &&
      typeof foundation === "number" &&
      Number.isInteger(foundation) &&
      foundation >= 100 &&
      size >= foundation
    );
  });
}
export function validWorkspaceLoadDimensions(data: Record<string, unknown>) {
  return ["skus", "pallets", "boxes"].every(
    (collection) =>
      Array.isArray(data[collection]) &&
      (data[collection] as unknown[]).every((value) => {
        if (!value || typeof value !== "object") return true;
        const item = value as Record<string, unknown>;
        return (
          hasValidLoadedPalletDimensions(item.packaging) &&
          hasValidLoadedPalletDimensions(item.packagingSnapshot)
        );
      }),
  );
}
