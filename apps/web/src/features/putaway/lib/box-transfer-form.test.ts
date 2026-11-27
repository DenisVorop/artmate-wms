import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { boxTransferSchema, transferableBoxes } from "./box-transfer-form";

const fixture = () =>
  ({
    boxes: [
      { id: "box", status: "stored", palletId: "pallet", locationId: "source" },
    ],
    pallets: [
      {
        id: "pallet",
        kind: "finished",
        status: "stored",
        locationId: "source",
      },
    ],
    locations: [
      { id: "source", kind: "rack", archived: false, blocked: false },
    ],
    putawayTasks: [],
    shipments: [],
    movements: [],
  }) as unknown as WorkspaceDto;

test("transfer selection excludes reserved, carried and unavailable boxes without changing inventory", () => {
  const state = fixture(),
    before = JSON.stringify(state);
  assert.equal(transferableBoxes(state).length, 1);
  assert.equal(JSON.stringify(state), before);
  state.putawayTasks = [
    { boxId: "box", status: "queued", transferZoneId: "zone" },
  ] as WorkspaceDto["putawayTasks"];
  assert.equal(transferableBoxes(state).length, 0);
  state.putawayTasks = [];
  state.shipments = [
    { status: "draft", boxIds: ["box"] },
  ] as WorkspaceDto["shipments"];
  assert.equal(transferableBoxes(state).length, 0);
  state.shipments = [];
  state.boxes[0].status = "in_transit";
  assert.equal(transferableBoxes(state).length, 0);
});

test("transfer form requires boxes, a destination different from source and a work zone", () => {
  const values = {
    fromLocationId: "A-08-01",
    toLocationId: "F-05",
    zoneId: "putaway",
    boxIds: ["box"],
  };
  assert.equal(boxTransferSchema.safeParse(values).success, true);
  assert.equal(
    boxTransferSchema.safeParse({
      ...values,
      toLocationId: values.fromLocationId,
    }).success,
    false,
  );
  assert.equal(
    boxTransferSchema.safeParse({ ...values, boxIds: [] }).success,
    false,
  );
  assert.equal(
    boxTransferSchema.safeParse({ ...values, zoneId: "" }).success,
    false,
  );
});
