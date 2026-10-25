import test from "node:test";
import assert from "node:assert/strict";
import {
  skuCreateDefaults,
  skuCreatePayload,
  skuCreateSchema,
} from "./sku-create-form";
import { submitSkuCreate } from "./sku-create-command";

test("theme creation trims name and barcode, defaults to 20, and omits generated code", () => {
  assert.deepEqual(
    skuCreatePayload({
      ...skuCreateDefaults,
      name: "  Котики-2  ",
      barcode: "  1234567890123  ",
    }),
    {
      name: "Котики-2",
      barcode: "1234567890123",
      unitsPerBox: 20,
    },
  );
});

test("theme requires name and barcode and respects field limits", () => {
  const values = { ...skuCreateDefaults, name: "Котики", barcode: "123" };
  for (const invalid of [
    { name: "   " },
    { barcode: "   " },
    { name: "я".repeat(101) },
    { barcode: "1".repeat(151) },
  ])
    assert.equal(
      skuCreateSchema.safeParse({ ...values, ...invalid }).success,
      false,
    );
  for (const unitsPerBox of [0, -1, 1.5, Number.NaN, 1001, Infinity])
    assert.equal(
      skuCreateSchema.safeParse({ ...values, unitsPerBox }).success,
      false,
    );
  for (const unitsPerBox of [1, 20, 1000])
    assert.equal(
      skuCreateSchema.safeParse({ ...values, unitsPerBox }).success,
      true,
    );
});

test("old-session creation neither submits nor announces a successful completion", async () => {
  let calls = 0;
  assert.equal(
    await submitSkuCreate(
      async () => {
        calls += 1;
      },
      () => false,
    ),
    false,
  );
  assert.equal(calls, 0);
  let current = true;
  let finish: () => void = () => {};
  const command = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = submitSkuCreate(
    () => command,
    () => current,
  );
  current = false;
  finish();
  assert.equal(await result, false);
});

test("creation errors remain actionable only for the current session", async () => {
  const error = new Error("Штрихкод уже занят");
  await assert.rejects(
    () =>
      submitSkuCreate(
        async () => {
          throw error;
        },
        () => true,
      ),
    error,
  );
  let current = true;
  assert.equal(
    await submitSkuCreate(
      async () => {
        current = false;
        throw error;
      },
      () => current,
    ),
    false,
  );
  assert.equal(
    await submitSkuCreate(
      async () => {},
      () => true,
    ),
    true,
  );
});
