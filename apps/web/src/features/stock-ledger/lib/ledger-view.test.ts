import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  StockLedgerEventDto,
  StockLedgerLineDto,
} from "@/shared/api/generated/model";
import {
  ledgerActor,
  ledgerContainerLabels,
  ledgerDate,
  ledgerDeltaTone,
  ledgerEventMeaning,
  ledgerKindLabels,
  ledgerStageLabels,
  signedLedgerQuantity,
} from "./ledger-view";
const line = (patch: Partial<StockLedgerLineDto> = {}): StockLedgerLineDto => ({
  skuId: "sku",
  skuCode: "CAT-2",
  skuName: "Котики-2 на момент операции",
  lotId: "lot",
  lotName: "Партия1",
  receivedAt: "2024-01-01T12:00:00Z",
  stage: "raw",
  containerType: "pallet",
  containerId: "raw",
  containerCode: "PAL-001",
  palletId: "raw",
  palletCode: "PAL-001",
  locationId: "rack",
  locationCode: "R-01-01",
  quantityDelta: -20,
  ...patch,
});
const event = (
  patch: Partial<StockLedgerEventDto> = {},
): StockLedgerEventDto => ({
  id: "event",
  revision: 4,
  requestId: "request",
  kind: "assembly",
  createdAt: "2024-01-02T12:00:00Z",
  employeeId: null,
  employeeName: null,
  reason: null,
  referenceType: "task",
  referenceId: "task",
  referenceCode: "JOB-001",
  unitsDelta: 0,
  lines: [
    line(),
    line({
      containerType: "box",
      containerId: "box",
      containerCode: "BOX-001",
      stage: "boxed",
      quantityDelta: 20,
    }),
  ],
  ...patch,
});
test("Начальная точка всегда «Система», а отсутствие snapshot исполнителя не подменяется текущим именем", () => {
  assert.equal(
    ledgerActor(
      event({
        kind: "opening_balance",
        employeeName: "Имя вне начального учёта",
      }),
    ),
    "Система",
  );
  for (const employeeName of [null, "", "  "])
    assert.equal(ledgerActor(event({ employeeName })), "Не указан");
  assert.equal(
    ledgerActor(event({ employeeName: "  Анна на момент операции  " })),
    "Анна на момент операции",
  );
});
test("Знак количества сохраняет направление, ноль не получает выдуманного плюса или минуса", () => {
  assert.equal(signedLedgerQuantity(20), "+20");
  assert.equal(signedLedgerQuantity(-20), "-20");
  assert.equal(signedLedgerQuantity(0), "0");
  assert.equal(signedLedgerQuantity(-0), "0");
  assert.equal(ledgerDeltaTone(20), "positive");
  assert.equal(ledgerDeltaTone(-20), "negative");
  assert.equal(ledgerDeltaTone(0), "neutral");
});
test("Внутренняя операция с минусом и плюсом по20 показывает итог0, а не новый приход20", () => {
  const transfer = event();
  assert.equal(
    transfer.lines.reduce((sum, item) => sum + item.quantityDelta, 0),
    0,
  );
  assert.equal(signedLedgerQuantity(transfer.unitsDelta), "0");
  assert.equal(ledgerEventMeaning(transfer), "Общий баланс не изменён");
  for (const kind of ["putaway", "movement"] as const)
    assert.equal(
      ledgerEventMeaning(event({ kind })),
      "Общий баланс не изменён",
    );
  assert.equal(transfer.lines[0].skuName, "Котики-2 на момент операции");
  assert.equal(transfer.lines[0].locationCode, "R-01-01");
});
test("Приход, списание и начальный остаток имеют разные последствия даже при нулевой начальной точке", () => {
  assert.equal(
    ledgerEventMeaning(event({ kind: "receipt_placement", unitsDelta: 1000 })),
    "Товар добавлен на баланс",
  );
  assert.equal(
    ledgerEventMeaning(event({ kind: "shipment", unitsDelta: -20 })),
    "Товар списан с баланса",
  );
  assert.equal(
    ledgerEventMeaning(event({ kind: "opening_balance", unitsDelta: 0 })),
    "Начальная точка учёта",
  );
  assert.equal(ledgerKindLabels.adjustment, "Корректировка");
});
test("Стадии и контейнеры различают НЗП и готовый короб, дата явно отображается по Москве", () => {
  assert.equal(ledgerStageLabels.wip, "В сборке");
  assert.equal(ledgerStageLabels.boxed, "В коробах");
  assert.equal(ledgerContainerLabels.task, "Задание");
  assert.equal(ledgerContainerLabels.box, "Короб");
  const date = ledgerDate("2024-01-24T21:01:02Z");
  assert.match(date, /25/);
  assert.match(date, /00:01:02/);
});
