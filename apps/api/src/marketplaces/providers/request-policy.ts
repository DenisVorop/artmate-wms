/** Internal resource and upstream pacing policy, independent of HTTP input. */
export const MARKETPLACE_RUN_TIMEOUT_MS = 12 * 60_000;
export const MARKETPLACE_RUN_LEASE_MS = MARKETPLACE_RUN_TIMEOUT_MS + 60_000;
export const MARKETPLACE_RUN_REQUEST_LIMIT = 1_000;
export const MARKETPLACE_MAX_RESPONSE_BYTES = 20_000_000;
export const MARKETPLACE_MAX_TOTAL_BYTES = 80_000_000;
export const MARKETPLACE_MAX_ATTEMPTS = 5;
export const MARKETPLACE_REQUEST_TIMEOUT_MS = 30_000;
export const WB_STATISTICS_REQUEST_TIMEOUT_MS = 120_000;
export const OZON_REQUEST_INTERVAL_MS = 1_000;
export const WB_REQUEST_INTERVAL_MS = {
  statistics: 61_000,
  analytics: 20_100,
  content: 650,
  supplies: 2_100,
} as const;
