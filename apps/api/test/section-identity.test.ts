import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSectionIdentity } from "../src/section-identity";

test("section copy identity uses the first free normalized base, name and all twenty child codes across both namespaces", () => {
  assert.deepEqual(generateSectionIdentity([], []), {
    code: "R-01",
    name: "Секция 1",
  });
  const sections = [
    { code: " r-01 ", name: "Other" },
    { code: "OTHER", name: " СЕКЦИЯ 2 " },
    { code: "R-03-20", name: "Reserved child in section namespace" },
  ];
  const locations = [{ code: " R-04 " }, { code: " r-05-17 " }];
  assert.deepEqual(generateSectionIdentity(sections, locations), {
    code: "R-06",
    name: "Секция 6",
  });
  assert.deepEqual(
    generateSectionIdentity(
      [{ code: "X", name: "Секция 1" }],
      [{ code: "r-02-20" }],
    ),
    { code: "R-03", name: "Секция 3" },
  );
});
