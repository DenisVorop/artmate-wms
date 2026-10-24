import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPutawayScans, putawayScanSchema } from "./putaway-form";
test("Оба подтверждения требуют явного скана, код и QR не заменяются данными карточки", () => {
  for (const values of [
    emptyPutawayScans(),
    { boxCode: "BOX-01", locationCode: "" },
    { boxCode: " ", locationCode: "LOC-01" },
  ])
    assert.equal(putawayScanSchema.safeParse(values).success, false);
  assert.deepEqual(
    putawayScanSchema.parse({
      boxCode: " artmate-wms:box:BOX-01 ",
      locationCode: " artmate-wms:location:address-id ",
    }),
    {
      boxCode: "artmate-wms:box:BOX-01",
      locationCode: "artmate-wms:location:address-id",
    },
  );
  assert.deepEqual(
    putawayScanSchema.parse({ boxCode: " BOX-01 ", locationCode: " RACK-01 " }),
    { boxCode: "BOX-01", locationCode: "RACK-01" },
  );
});
test("Новая фаза начинает два пустых поля и не переиспользует мутабельный объект предыдущего скана", () => {
  const take = emptyPutawayScans();
  take.boxCode = "BOX-01";
  take.locationCode = "ASSEMBLY-01";
  assert.deepEqual(emptyPutawayScans(), { boxCode: "", locationCode: "" });
});
