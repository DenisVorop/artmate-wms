import test from "node:test";
import assert from "node:assert/strict";
import { isFreshMarketplaceSync } from "./connection-state";
const now = Date.parse("2026-10-25T10:00:00Z");
test("fresh sync blocks duplicate work only during server lease", () => {
  assert.equal(
    isFreshMarketplaceSync(
      {
        syncStatus: "running",
        lastAttemptAt: new Date(now - 299999).toISOString(),
      },
      now,
    ),
    true,
  );
  assert.equal(
    isFreshMarketplaceSync(
      {
        syncStatus: "running",
        lastAttemptAt: new Date(now - 300000).toISOString(),
      },
      now,
    ),
    false,
  );
  assert.equal(
    isFreshMarketplaceSync(
      { syncStatus: "success", lastAttemptAt: new Date(now).toISOString() },
      now,
    ),
    false,
  );
});
test("missing invalid and future attempt timestamp allow explicit server-checked recovery", () => {
  for (const date of [null, "broken", new Date(now + 1).toISOString()])
    assert.equal(
      isFreshMarketplaceSync(
        { syncStatus: "running", lastAttemptAt: date },
        now,
      ),
      false,
    );
});
