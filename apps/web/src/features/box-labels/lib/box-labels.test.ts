import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoxLabelPageDto } from "@/shared/api/generated/model";
import { boxLabelBatchSchema, completeFreeLabelPage } from "./box-labels";
const label = {
  id: "label-1",
  code: "BOX-PRE-1",
  payload: "artmate-wms:box:BOX-PRE-1",
  svg: "<svg />",
  status: "free" as const,
  taskId: null,
  boxId: null,
};
const page: BoxLabelPageDto = {
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
      code: "BOX-PRE-2",
      payload: "artmate-wms:box:BOX-PRE-2",
    },
  ],
  total: 3,
  page: 1,
  pageSize: 2,
};
test("Batch amount accepts integer 1..1000 only", () => {
  for (const count of [1, 100, 1000])
    assert.equal(boxLabelBatchSchema.safeParse({ count }).success, true);
  for (const count of [0, 1001, 1.2, NaN, "100"])
    assert.equal(boxLabelBatchSchema.safeParse({ count }).success, false);
});
test("Print accepts only complete free page belonging to requested batch and range", () => {
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
            code: "BOX-PRE-3",
            payload: "artmate-wms:box:BOX-PRE-3",
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
    {
      ...page,
      items: [
        label,
        { ...label, id: "other", code: "OTHER", status: "assigned" as const },
      ],
    },
    {
      ...page,
      items: [label, { ...label, id: "other", code: "OTHER", taskId: "task" }],
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
