import test from "node:test";
import assert from "node:assert/strict";
import {
  isPreprintedPalletScan,
  receiptPalletScan,
} from "./receipt-pallet-scan";
import { matchesScan } from "./handling";
const issued = "PLT-PRE-61310AC3-53E1-4A6A-96BE-DB6AB51AA945";
const pallet = { id: "incoming-pallet", code: "PLT-LEGACY" };
test("receipt accepts its original pallet identity without consuming a spare label", async () => {
  for (const value of [pallet.code, `artmate-wms:pallet:${pallet.id}`]) {
    const result = await receiptPalletScan(value, pallet, async () => {
      throw Error("Must not bind");
    });
    assert.equal(result.accepted, true);
  }
});
test("a spare pallet QR waits for the server before accepting the first scan", async () => {
  let release!: (value: boolean) => void;
  const inputs: string[] = [];
  const result = receiptPalletScan(
    ` artmate-wms:pallet:${issued} `,
    pallet,
    (value) => {
      inputs.push(value);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  );
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(inputs, [`artmate-wms:pallet:${issued}`]);
  release(true);
  assert.deepEqual(await result, { accepted: true, error: null });
});
test("used, refused or unconfirmed labels leave the first step unaccepted and preserve server error", async () => {
  assert.deepEqual(await receiptPalletScan(issued, pallet, async () => false), {
    accepted: false,
    error: null,
  });
});
test("wrong entity QR and malformed labels never reach binding", async () => {
  for (const value of [
    "artmate-wms:box:" + issued,
    "artmate-wms:location:" + pallet.id,
    "PLT-PRE-not-issued",
    "2000000000015",
    "arbitrary-code",
  ]) {
    assert.equal(isPreprintedPalletScan(value), false);
    const result = await receiptPalletScan(value, pallet, async () => {
      throw Error("Must not bind");
    });
    assert.equal(result.accepted, false);
    assert.match(result.error!, /этикетку паллеты/);
  }
});
test("the bound spare QR works again for receiving and movement without rebinding", async () => {
  const bound = { ...pallet, code: issued };
  assert.equal(
    matchesScan(`artmate-wms:pallet:${issued}`, "pallet", bound.id, bound.code),
    true,
  );
  assert.equal(
    matchesScan(`artmate-wms:box:${issued}`, "pallet", bound.id, bound.code),
    false,
  );
  assert.equal(
    matchesScan(
      `artmate-wms:pallet:PLT-LEGACY`,
      "pallet",
      pallet.id,
      pallet.code,
    ),
    false,
  );
  assert.equal(
    (
      await receiptPalletScan(
        `artmate-wms:pallet:${issued}`,
        bound,
        async () => {
          throw Error("Must not rebind");
        },
      )
    ).accepted,
    true,
  );
});
