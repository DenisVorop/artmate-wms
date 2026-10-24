import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthAccountDto } from "@/shared/api/generated/model";
import { accessCreateSchema, resetPasswordSchema } from "./access-form";
import { isLastManager } from "./access-policy";
const account = (patch: Partial<AuthAccountDto> = {}): AuthAccountDto => ({
  id: "a",
  employeeId: "employee",
  login: "manager",
  name: "Анна",
  role: "manager",
  blocked: false,
  mustChangePassword: false,
  createdAt: "2026-01-01",
  lastLoginAt: null,
  activeSessions: 1,
  ...patch,
});
test("Доступ связан с existing employee, роль только manager/employee, пароль временный вводится явно", () => {
  const values = {
    employeeId: "employee",
    login: " Worker.1 ",
    role: "employee",
    password: "temporary password",
  };
  assert.equal(accessCreateSchema.parse(values).login, "worker.1");
  assert.equal(
    accessCreateSchema.safeParse({ ...values, employeeId: "" }).success,
    false,
  );
  assert.equal(
    accessCreateSchema.safeParse({ ...values, role: "admin" }).success,
    false,
  );
  assert.equal(
    accessCreateSchema.safeParse({ ...values, password: "short" }).success,
    false,
  );
  assert.equal(resetPasswordSchema.safeParse({ password: "" }).success, false);
});
test("Последнего активного руководителя нельзя блокировать/понижать; blocked manager не заменяет активного", () => {
  const own = account();
  assert.equal(isLastManager(own, [own]), true);
  assert.equal(
    isLastManager(own, [own, account({ id: "blocked", blocked: true })]),
    true,
  );
  assert.equal(isLastManager(own, [own, account({ id: "second" })]), false);
  assert.equal(isLastManager(account({ role: "employee" }), [own]), false);
});
