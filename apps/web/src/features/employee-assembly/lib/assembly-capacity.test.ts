import { test } from "node:test";
import assert from "node:assert/strict";
import { assemblyWaitsForSpace } from "./assembly-capacity";

const full = {
  level: "full" as const,
  locationId: "assembly",
  palletId: "shared",
  boxes: 1,
  committedBoxes: 17,
  capacityBoxes: 18,
  message: "Места заняты текущей сборкой.",
};
test("full assembly capacity stops only a new physical box, not confirmed or partially scanned work", () => {
  const unopened = {
    boxCodeConfirmed: false,
    scannedUnits: 0,
    sourcePalletId: "already-scanned-source",
    openBoxCode: "preallocated-label",
  };
  assert.equal(assemblyWaitsForSpace(full, unopened), true);
  assert.equal(
    assemblyWaitsForSpace(full, { ...unopened, boxCodeConfirmed: true }),
    false,
  );
  assert.equal(
    assemblyWaitsForSpace(full, { ...unopened, scannedUnits: 1 }),
    false,
  );
  assert.equal(assemblyWaitsForSpace(full, null), false);
  for (const level of ["normal", "near_full", "unavailable"] as const)
    assert.equal(assemblyWaitsForSpace({ ...full, level }, unopened), false);
  assert.equal(assemblyWaitsForSpace(undefined, unopened), false);
});
