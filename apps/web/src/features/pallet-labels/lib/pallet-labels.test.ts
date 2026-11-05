import assert from "node:assert/strict";
import { test } from "node:test";
import type { PalletLabelPageDto } from "@/shared/api/generated/model";
import { palletLabelBatchSchema, completeFreeLabelPage } from "./pallet-labels";
const label = {
  id: "label-1",
  ordinal: 1,
  code: "PLT-PRE-1",
  payload: "artmate-wms:pallet:PLT-PRE-1",
  svg: "<svg />",
  status: "free" as const,
  receiptId: null,
  palletId: null,
};
const page: PalletLabelPageDto = {
  batch: {
    id: "batch",
    code: "LBL-1",
    count: 3,
    freeCount: 3,
    assignedCount: 0,
    createdAt: "2026-10-25T10:00:00.000Z",
  },
  items: [
    label,
    {
      ...label,
      id: "label-2",
      ordinal: 2,
      code: "PLT-PRE-2",
      payload: "artmate-wms:pallet:PLT-PRE-2",
    },
  ],
  total: 3,
  page: 1,
  pageSize: 2,
};
test("Pallet batch amount accepts integer 1..1000 only", () => {
  for (const count of [1, 100, 1000])
    assert.equal(palletLabelBatchSchema.safeParse({ count }).success, true);
  for (const count of [0, 1001, 1.2, NaN, "100"])
    assert.equal(palletLabelBatchSchema.safeParse({ count }).success, false);
});
test("Pallet print accepts only complete free page belonging to requested batch and range", () => {
  assert.equal(completeFreeLabelPage(page, "batch", 1, 2), true);
  assert.equal(
    completeFreeLabelPage(
      {
        ...page,
        page: 2,
        items: [
          {
            ...label,
            id: "label-3",
            ordinal: 3,
            code: "PLT-PRE-3",
            payload: "artmate-wms:pallet:PLT-PRE-3",
          },
        ],
      },
      "batch",
      2,
      2,
    ),
    true,
  );
  for (const invalid of [
    undefined,
    { ...page, items: [label] },
    { ...page, items: [label, label] },
    { ...page, items: [label, { ...label, id: "other" }] },
    { ...page, total: 1000 },
    { ...page, items: [label, { ...page.items[1], ordinal: 1 }] },
    { ...page, items: [label, { ...page.items[1], ordinal: 0 }] },
    { ...page, items: [label, { ...page.items[1], ordinal: 4 }] },
    { ...page, items: [label, { ...page.items[1], ordinal: 1.2 }] },
    {
      ...page,
      items: [
        label,
        {
          ...page.items[1],
          code: "BOX-PRE-2",
          payload: "artmate-wms:pallet:BOX-PRE-2",
        },
      ],
    },
    {
      ...page,
      items: [
        label,
        { ...page.items[1], payload: "artmate-wms:box:PLT-PRE-2" },
      ],
    },
    { ...page, items: [label, { ...page.items[1], palletId: "pallet" }] },
    {
      ...page,
      items: [
        label,
        { ...label, id: "other", code: "OTHER", status: "assigned" as const },
      ],
    },
    {
      ...page,
      items: [
        label,
        { ...label, id: "other", code: "OTHER", receiptId: "task" },
      ],
    },
    {
      ...page,
      items: [label, { ...label, id: "other", code: "OTHER", svg: "" }],
    },
  ])
    assert.equal(completeFreeLabelPage(invalid, "batch", 1, 2), false);
  assert.equal(completeFreeLabelPage(page, "another", 1, 2), false);
  assert.equal(completeFreeLabelPage(page, "batch", 2, 2), false);
  assert.equal(completeFreeLabelPage(page, "batch", 1, 100), false);
});
