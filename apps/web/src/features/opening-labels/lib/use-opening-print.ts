"use client";
import { useState } from "react";
import type { LabelDto } from "@/shared/api/generated/model";
import type { RollLabelFormat } from "@/shared/lib/label-paper";
export function useOpeningPrint(
  identity: string,
  labels: { ref: { type: string; id: string }; label: LabelDto }[],
  enabled: boolean,
  kind: "pallet" | "box",
) {
  const [formats, setFormats] = useState<
      Record<"pallet" | "box", RollLabelFormat>
    >({ pallet: "75x120", box: "58x40" }),
    [attempt, setAttempt] = useState(0),
    [images, setImages] = useState<Record<string, "loaded" | "failed">>({});
  const format = formats[kind];
  const setFormat = (value: RollLabelFormat) =>
    setFormats((current) => ({ ...current, [kind]: value }));
  const key = (item: (typeof labels)[number]) =>
    JSON.stringify([
      identity,
      item.ref.type,
      item.ref.id,
      item.label.svg,
      format,
      attempt,
    ]);
  const ready =
    enabled &&
    labels.length > 0 &&
    labels.every((item) => images[key(item)] === "loaded");
  return {
    format,
    setFormat,
    key,
    ready,
    failed: labels.some((item) => images[key(item)] === "failed"),
    loaded: (key: string) =>
      setImages((current) => ({ ...current, [key]: "loaded" })),
    fail: (key: string) =>
      setImages((current) => ({ ...current, [key]: "failed" })),
    retry: () => setAttempt((n) => n + 1),
    print: () => {
      if (ready) window.print();
    },
  };
}
