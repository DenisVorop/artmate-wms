import type { MarketplaceConnectionDto } from "@/shared/api/generated/model";
export function isFreshMarketplaceSync(
  connection: Pick<MarketplaceConnectionDto, "syncStatus" | "lastAttemptAt">,
  now = Date.now(),
) {
  const age = connection.lastAttemptAt
    ? now - Date.parse(connection.lastAttemptAt)
    : Number.NaN;
  return (
    connection.syncStatus === "running" &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < 5 * 60_000
  );
}
