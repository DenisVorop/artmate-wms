import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assemblySchema,
  assignmentSchema,
  buildAssembly,
  buildAssignment,
  scanSchema,
} from "./assembly-form";
const values = { skuId: "sku-cat", boxesTarget: 2, employeeId: "" };
test("Свободное задание не получает выдуманного исполнителя; optional assignment сохраняется при создании", () => {
  const free = buildAssembly(assemblySchema.parse(values));
  assert.deepEqual(
    { skuId: free.skuId, boxesTarget: free.boxesTarget },
    { skuId: "sku-cat", boxesTarget: 2 },
  );
  assert.equal("employeeId" in free, false);
  assert.equal("status" in free, false);
  const planned = buildAssembly(
    assemblySchema.parse({ ...values, employeeId: " employee-off " }),
  );
  assert.equal(planned.employeeId, "employee-off");
  assert.match(planned.requestId, /^[0-9a-f-]{36}$/);
});
test("Создание требует тематику и 1..1000 целых коробов; норма упаковки не задаётся вручную", () => {
  for (const boxesTarget of [0, -1, 1.5, 1001, Number.NaN])
    assert.equal(
      assemblySchema.safeParse({ ...values, boxesTarget }).success,
      false,
    );
  for (const boxesTarget of [1, 1000])
    assert.equal(
      assemblySchema.safeParse({ ...values, boxesTarget }).success,
      true,
    );
  assert.equal(
    assemblySchema.safeParse({ ...values, skuId: "  " }).success,
    false,
  );
  assert.equal("unitsPerBox" in buildAssembly(values), false);
});
test("Снятие назначения отправляет explicit null, выбранный сотрудник — точный id", () => {
  assert.equal(
    buildAssignment(assignmentSchema.parse({ employeeId: "" })).employeeId,
    null,
  );
  assert.equal(
    buildAssignment({ employeeId: "  employee  " }).employeeId,
    "employee",
  );
});
test("Скан требует явного непустого ввода, сохраняет читаемые и QR коды без подмены", () => {
  for (const value of ["", "   ", "\n"])
    assert.equal(scanSchema.safeParse({ value }).success, false);
  for (const value of [
    "PAL-001",
    "BOX-001",
    "artmate-wms:pallet:abc",
    "artmate-wms:box:BOX-001",
    "4601234567890",
  ])
    assert.deepEqual(scanSchema.parse({ value: ` ${value} ` }), { value });
});
