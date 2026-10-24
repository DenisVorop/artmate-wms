import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeSchema, toCreateEmployee } from "./employee-form";

test("Пустое имя отклоняется, необязательная пустая должность не отправляется", () => {
  assert.equal(
    employeeSchema.safeParse({ name: "   ", role: "" }).success,
    false,
  );
  const values = employeeSchema.parse({ name: "  Иван Петров  ", role: "   " });
  const dto = toCreateEmployee(values);
  assert.equal(dto.name, "Иван Петров");
  assert.equal("role" in dto, false);
  assert.ok(dto.requestId);
  assert.equal(
    toCreateEmployee({ name: "Иван", role: "  Приёмщик " }).role,
    "Приёмщик",
  );
});
