import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionSchema,
  connectionSchemaFor,
  connectionPayload,
  mappingPayload,
  mappingSchema,
} from "./integration-form";
test("connection keeps key only in form and requires nonempty credential", () => {
  assert.equal(
    connectionSchema.safeParse({ apiKey: "   ", clientId: "" }).success,
    false,
  );
  assert.deepEqual(
    connectionSchema.parse({ apiKey: "  secret-key  ", clientId: "  123  " }),
    { apiKey: "secret-key", clientId: "123" },
  );
});
test("Ozon requires client ID; WB payload never carries an unrelated client ID", () => {
  assert.equal(
    connectionSchemaFor("ozon").safeParse({ apiKey: "test-key", clientId: "" })
      .success,
    false,
  );
  assert.equal(
    connectionSchemaFor("wildberries").safeParse({
      apiKey: "test-key",
      clientId: "",
    }).success,
    true,
  );
  assert.deepEqual(
    connectionPayload("wildberries", { apiKey: " test-key ", clientId: "123" }),
    { provider: "wildberries", apiKey: "test-key" },
  );
  assert.deepEqual(
    connectionPayload("ozon", { apiKey: " test-key ", clientId: " 123 " }),
    { provider: "ozon", apiKey: "test-key", clientId: "123" },
  );
  assert.deepEqual(
    mappingPayload(
      { provider: "ozon", externalId: "listing" },
      { skuId: "theme", unitsPerItem: 10 },
    ),
    {
      provider: "ozon",
      externalId: "listing",
      skuId: "theme",
      unitsPerItem: 10,
    },
  );
});
test("mapping needs explicit theme and positive integral units per marketplace item", () => {
  assert.equal(
    mappingSchema.safeParse({ skuId: "", unitsPerItem: 1 }).success,
    false,
  );
  for (const value of [0, -1, 1.5, Number.NaN, 10001])
    assert.equal(
      mappingSchema.safeParse({ skuId: "theme", unitsPerItem: value }).success,
      false,
    );
  assert.deepEqual(mappingSchema.parse({ skuId: "theme", unitsPerItem: 10 }), {
    skuId: "theme",
    unitsPerItem: 10,
  });
});
