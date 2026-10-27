import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateProductionEnvironment } from "../src/production-config";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
const valid = () => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://test:test@postgres:5432/wms_test",
  WEB_ORIGIN: "https://wms.example.com",
  WMS_AUTH_COOKIE_SECURE: "true",
  WMS_AUTH_COOKIE_NAME: "__Host-wms_session",
  WMS_MARKETPLACE_KEY: Buffer.alloc(32, 7).toString("base64"),
});
test("production accepts complete PostgreSQL, exact HTTPS origins and canonical external key", async () => {
  await validateProductionEnvironment(valid());
  await validateProductionEnvironment({
    ...valid(),
    WEB_ORIGIN: "https://wms.example.com,https://wms-staging.example.com:8443",
  });
  await validateProductionEnvironment({ NODE_ENV: "test" });
  await validateProductionEnvironment({ NODE_ENV: "development" });
});
test("production rejects fallback storage, unsafe origins/cookies and malformed keys without echoing secrets", async () => {
  const examples = [
    { WMS_MARKETPLACE_KEY: undefined },
    { DATABASE_URL: undefined },
    { DATABASE_URL: "https://private:do-not-log@example.com/db" },
    { DATABASE_URL: "postgres://postgres/db" },
    { DATABASE_URL: "postgres://user:pass@postgres" },
    { WMS_DATA_DIR: "memory://" },
    { WMS_DATA_DIR: "" },
    ...[
      undefined,
      "",
      "http://wms.example.com",
      "https://*.example.com",
      "https://wms.example.com/",
      "https://wms.example.com/path",
      "https://wms.example.com?query=1",
      "https://user:pass@wms.example.com",
      " https://wms.example.com",
      "https://wms.example.com,",
    ].map((WEB_ORIGIN) => ({ WEB_ORIGIN })),
    { WMS_AUTH_COOKIE_SECURE: "false" },
    { WMS_AUTH_COOKIE_SECURE: undefined },
    ...[
      undefined,
      "wms_session",
      "__Host-session",
      "__Host-wms_session; Domain=example.com",
    ].map((WMS_AUTH_COOKIE_NAME) => ({ WMS_AUTH_COOKIE_NAME })),
    { WMS_MARKETPLACE_KEY: Buffer.alloc(31).toString("base64") },
    { WMS_MARKETPLACE_KEY: "not-a-private-key" },
  ];
  for (const example of examples) {
    await assert.rejects(
      validateProductionEnvironment({ ...valid(), ...example }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("do-not-log"));
        assert.ok(!error.message.includes("not-a-private-key"));
        return true;
      },
      JSON.stringify(Object.keys(example)),
    );
  }
});
test("production uses an existing original raw key and never creates missing files or directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-production-key-"));
  try {
    const path = join(dir, "original.key");
    await writeFile(path, Buffer.alloc(32, 8), { mode: 0o600 });
    await validateProductionEnvironment({
      ...valid(),
      WMS_MARKETPLACE_KEY: undefined,
      WMS_MARKETPLACE_KEY_FILE: path,
    });
    const secret = new MarketplaceSecrets({ path, production: true });
    const encrypted = await secret.encrypt({ apiKey: "test-only" }, "ozon");
    assert.deepEqual(
      await new MarketplaceSecrets({ path, production: true }).decrypt(
        encrypted,
        "ozon",
      ),
      { apiKey: "test-only" },
    );
    await assert.rejects(
      new MarketplaceSecrets({
        path: join(dir, "absent", "key"),
        production: true,
      }).validateKey(),
      /unavailable/,
    );
    assert.deepEqual(await readdir(dir), ["original.key"]);
    await writeFile(path, Buffer.alloc(31), { mode: 0o600 });
    await assert.rejects(
      validateProductionEnvironment({
        ...valid(),
        WMS_MARKETPLACE_KEY: undefined,
        WMS_MARKETPLACE_KEY_FILE: path,
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
