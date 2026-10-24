import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountLoginSchema,
  loginSchema,
  passwordChangeSchema,
  setupSchema,
} from "./auth-form";
test("Логин нормализуется, пароль сохраняет точные символы для password manager и вставки", () => {
  const values = loginSchema.parse({
    login: "  MANAGER.Local ",
    password: " secret password ",
  });
  assert.equal(values.login, "manager.local");
  assert.equal(values.password, " secret password ");
  assert.equal(accountLoginSchema.safeParse("Логин").success, false);
  assert.equal(accountLoginSchema.safeParse("ab").success, false);
  assert.equal(accountLoginSchema.parse(" Work_01 "), "work_01");
});
test("Первый руководитель требует своё имя и длинный совпадающий пароль, не получает default credentials", () => {
  const values = {
    name: " Анна ",
    login: "anna",
    password: "my own strong password",
    repeatPassword: "my own strong password",
  };
  assert.equal(setupSchema.parse(values).name, "Анна");
  assert.equal(
    setupSchema.safeParse({
      ...values,
      password: "short",
      repeatPassword: "short",
    }).success,
    false,
  );
  assert.equal(
    setupSchema.safeParse({ ...values, repeatPassword: "different password" })
      .success,
    false,
  );
  assert.equal(setupSchema.safeParse({ ...values, name: "" }).success, false);
});
test("Forced change требует текущий временный пароль и новый отличный совпадающий, не обрезает пробелы", () => {
  const values = {
    currentPassword: "temporary secret",
    newPassword: "my new long password ",
    repeatPassword: "my new long password ",
  };
  assert.equal(
    passwordChangeSchema.parse(values).newPassword,
    "my new long password ",
  );
  assert.equal(
    passwordChangeSchema.safeParse({ ...values, currentPassword: "" }).success,
    false,
  );
  assert.equal(
    passwordChangeSchema.safeParse({
      ...values,
      newPassword: values.currentPassword,
      repeatPassword: values.currentPassword,
    }).success,
    false,
  );
  assert.equal(
    passwordChangeSchema.safeParse({
      ...values,
      repeatPassword: "not same password",
    }).success,
    false,
  );
});
