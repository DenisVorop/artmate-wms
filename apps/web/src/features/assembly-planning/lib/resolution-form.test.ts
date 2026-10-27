import test from "node:test";
import assert from "node:assert/strict";
import { resolutionCommand, resolutionSchema } from "./resolution-form";

const values = {
  kind: "exclude_supply" as const,
  provider: "wildberries" as const,
  supplyId: "supply:example",
  externalId: "product",
  donorProvider: "ozon" as const,
  note: "  Поставка утрачена  ",
};
test("resolution commands omit hidden identifiers and trim the reason", () => {
  assert.deepEqual(resolutionCommand(resolutionSchema.parse(values)), {
    kind: "exclude_supply",
    provider: "wildberries",
    supplyId: "supply:example",
    enabled: true,
    note: "Поставка утрачена",
  });
  assert.deepEqual(resolutionCommand({ ...values, kind: "zero_stock" }), {
    kind: "zero_stock",
    provider: "wildberries",
    externalId: "product",
    enabled: true,
    note: "Поставка утрачена",
  });
  assert.equal(
    resolutionCommand({ ...values, kind: "launch" }).donorProvider,
    "ozon",
  );
});
test("explicit subject, reason and different donor are required", () => {
  for (const patch of [
    { note: "  " },
    { note: "x".repeat(501) },
    { supplyId: "" },
    { provider: "ozon" },
    { kind: "zero_stock", externalId: "" },
    { kind: "launch", donorProvider: "wildberries" },
  ])
    assert.equal(
      resolutionSchema.safeParse({ ...values, ...patch }).success,
      false,
    );
  assert.equal(
    resolutionSchema.safeParse({ ...values, kind: "launch" }).success,
    true,
  );
});
