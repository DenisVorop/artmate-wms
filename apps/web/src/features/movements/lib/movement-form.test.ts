import assert from "node:assert/strict";
import { test } from "node:test";
import { wholePalletMovementAllowed } from "./movement-form";

test("Общий накопитель не предлагается целиком; тематическая паллета с входящим резервом ждёт завершения размещения", () => {
  const data: Parameters<typeof wholePalletMovementAllowed>[0] = {
    putawayTasks: [
      {
        id: "task",
        code: "PUT-1",
        boxId: "box",
        skuId: "sku",
        status: "claimed",
        employeeId: "e",
        fromPalletId: "common",
        fromLocationId: "assembly",
        toLocationId: "target",
        createdAt: "2026-10-23T00:00:00Z",
        claimedAt: "2026-10-23T00:00:00Z",
        takenAt: null,
        completedAt: null,
      },
    ],
  };
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "common",
      kind: "assembly",
      locationId: "assembly",
    }),
    false,
  );
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "finished",
      kind: "finished",
      locationId: "target",
    }),
    false,
  );
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "finished",
      kind: "finished",
      locationId: "other",
    }),
    true,
  );
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "common",
      kind: "finished",
      locationId: "assembly",
    }),
    false,
  );
  data.putawayTasks[0].status = "completed";
  assert.equal(
    wholePalletMovementAllowed(data, {
      id: "finished",
      kind: "finished",
      locationId: "target",
    }),
    true,
  );
});
