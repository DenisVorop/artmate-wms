import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
test("marketplace keys are lazy, authenticated, randomized, durable and owner-only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-marketplace-secrets-")),
    path = join(dir, "secret.key");
  try {
    const s = new MarketplaceSecrets({ path });
    await assert.rejects(stat(path), /ENOENT/);
    const secret = { apiKey: "private-key-never-store-plain", clientId: "123" };
    const a = await s.encrypt(secret, "ozon"),
      b = await s.encrypt(secret, "ozon");
    assert.notEqual(a, b);
    assert.ok(!a.includes(secret.apiKey));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path)).length, 32);
    assert.deepEqual(
      await new MarketplaceSecrets({ path }).decrypt(a, "ozon"),
      secret,
    );
    await assert.rejects(s.decrypt(a, "wildberries"), /расшифровать/);
    await assert.rejects(
      s.decrypt(a.slice(0, -6) + "AAAAAA", "ozon"),
      /расшифровать/,
    );
    assert.equal(await s.fingerprint(secret), await s.fingerprint(secret));
    assert.notEqual(
      await s.fingerprint(secret),
      await s.fingerprint({ ...secret, clientId: "456" }),
    );
    await chmod(path, 0o644);
    await assert.rejects(
      new MarketplaceSecrets({ path }).encrypt(secret, "ozon"),
      /0600/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
