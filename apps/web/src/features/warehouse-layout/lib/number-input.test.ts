import assert from "node:assert/strict";
import { test } from "node:test";
import { nullableNumberFromInput } from "./number-input";
import { profileDefaults } from "./location-form";
import { sectionSchema } from "./rack-form";

test("Добавление яруса и повторная регистрация сохраняют пустую массу как null", () => {
  for (const blank of ["", "   ", null, undefined]) {
    let value: unknown = blank;
    // Initial input, appending a copied profile, and resetting addresses all re-register fields.
    for (let registration = 0; registration < 3; registration++)
      value = nullableNumberFromInput(value);
    assert.equal(value, null);
  }
  const profile = {
    ...profileDefaults(),
    maxWeightKg: nullableNumberFromInput(null),
  };
  const section = sectionSchema.parse({
    code: "QA-SEC",
    name: "Проверка секции",
    x: 1,
    y: 1,
    width: 3,
    depth: 2,
    rotation: 0,
    levels: [
      { ...profile, code: "QA-SEC-01", name: "Ярус 1" },
      {
        ...profile,
        code: "QA-SEC-02",
        name: "Ярус 2",
        maxWeightKg: nullableNumberFromInput(profile.maxWeightKg),
      },
    ],
  });
  assert.deepEqual(
    section.levels.map((level) => level.maxWeightKg),
    [null, null],
  );
});

test("Введённая масса сохраняется, а явный ноль не маскируется как отсутствие лимита", () => {
  assert.equal(nullableNumberFromInput("350.5"), 350.5);
  assert.equal(nullableNumberFromInput(350.5), 350.5);
  assert.equal(nullableNumberFromInput(0), 0);
  assert.equal(nullableNumberFromInput("0"), 0);
});
