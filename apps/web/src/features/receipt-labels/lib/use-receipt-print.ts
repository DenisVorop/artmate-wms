"use client";
import { useState } from "react";
import type { ReceiptLabelDto } from "@/shared/api/generated/model";
import type { RollLabelFormat } from "@/shared/lib/label-paper";

type ReceiptPrintLabel = Pick<ReceiptLabelDto, "palletId" | "svg">;
export function useReceiptPrint(
  receiptId: string,
  labels: ReceiptPrintLabel[],
  enabled = true,
) {
  const [format, setFormat] = useState<RollLabelFormat>("75x120");
  const [images, setImages] = useState<Record<string, "loaded" | "failed">>({});
  const [attempt, setAttempt] = useState(0);
  const key = (label: ReceiptPrintLabel) =>
    JSON.stringify([receiptId, label.palletId, label.svg, format, attempt]);
  const ready =
    enabled &&
    labels.length > 0 &&
    labels.every((label) => !!label.svg && images[key(label)] === "loaded");
  const failed = labels.some((label) => images[key(label)] === "failed");
  return {
    format,
    setFormat,
    key,
    ready,
    failed,
    markLoaded: (imageKey: string) =>
      setImages((current) => ({ ...current, [imageKey]: "loaded" })),
    markFailed: (imageKey: string) =>
      setImages((current) => ({ ...current, [imageKey]: "failed" })),
    retryImages: () => setAttempt((value) => value + 1),
    print: () => {
      if (ready) window.print();
    },
  };
}
