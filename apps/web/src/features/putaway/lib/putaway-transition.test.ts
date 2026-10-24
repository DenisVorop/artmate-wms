import assert from "node:assert/strict";
import { test } from "node:test";
import type { PutawayTaskDto } from "@/shared/api/generated/model";
import { putawayTransition } from "./putaway-transition";
const task = (status: PutawayTaskDto["status"]): PutawayTaskDto => ({
  id: "put-1",
  code: "PUT-001",
  boxId: "box-1",
  skuId: "cats",
  status,
  employeeId: status === "queued" ? null : "actor",
  fromPalletId: "common-pallet",
  fromLocationId: "source",
  toLocationId: status === "queued" ? null : "target",
  createdAt: "2024-01-01",
  claimedAt: null,
  takenAt: null,
  completedAt: null,
});
test("Захват ведёт к своему заданию с зарезервированным адресом, забор — к place без возможности бросить короб", () => {
  const claimed = putawayTransition("claim", task("claimed"));
  assert.equal(claimed.tab, "mine");
  assert.equal(claimed.selectedId, "put-1");
  assert.match(claimed.notice, /зарезервирован/);
  const taken = putawayTransition("take", task("in_transit"));
  assert.equal(taken.tab, "mine");
  assert.match(taken.notice, /Освободить задание после забора нельзя/);
});
test("После доставки UI выбирает историю того же задания, а не автоматически следующую работу", () => {
  const result = putawayTransition("place", task("completed"));
  assert.equal(result.tab, "completed");
  assert.equal(result.selectedId, "put-1");
  assert.match(result.notice, /Баланс сохранён/);
  assert.match(result.notice, /по желанию/);
});
test("Возврат до забора освобождает место и показывает queued, не имитируя физического переноса", () => {
  const queued = task("queued");
  const result = putawayTransition("release", queued);
  assert.equal(result.tab, "queued");
  assert.equal(result.selectedId, queued.id);
  assert.match(result.notice, /Резерв адреса снят/);
  assert.match(result.notice, /остаётся на накопительной паллете/);
  assert.equal(queued.toLocationId, null);
});
test("Повтор со свежим отличающимся статусом сообщает подтверждение, не делает дополнительного перехода состояния", () => {
  const carried = task("in_transit");
  const result = putawayTransition("claim", carried);
  assert.equal(result.tab, "mine");
  assert.equal(result.selectedId, carried.id);
  assert.equal(carried.status, "in_transit");
  assert.match(result.notice, /подтверждено сервером/);
});
