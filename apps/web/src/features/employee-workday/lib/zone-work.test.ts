import test from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { ownZoneWork, isWorkZoneScan } from "./zone-work";
test("zone scans are distinct from actual addresses, pallets and product barcodes", () => {
  assert.equal(isWorkZoneScan(" artmate-wms:work-zone:z "), true);
  for (const code of [
    "artmate-wms:location:z",
    "artmate-wms:box:z",
    "WZ-01",
    "barcode",
  ])
    assert.equal(isWorkZoneScan(code), false);
});
test("only an own assignment with a live matching zone can choose work", () => {
  const data = {
    warehouse: {
      workZones: [
        { id: "a", archived: false },
        { id: "b", archived: true },
      ],
      zoneWork: [
        { employeeId: "other", zoneId: "a" },
        { employeeId: "self", zoneId: "b" },
      ],
    },
  } as unknown as WorkspaceDto;
  assert.equal(ownZoneWork(data, "self"), null);
  data.warehouse.zoneWork[1].zoneId = "a";
  assert.equal(ownZoneWork(data, "self")?.assignment.employeeId, "self");
  assert.equal(ownZoneWork(undefined, "self"), null);
});
