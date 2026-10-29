"use client";
import { useState } from "react";
import type { LabelDto } from "@/shared/api/generated/model";

export function useA4Print(labels: { key: string; label: LabelDto }[]) {
  const [output, setOutput] = useState<"a4" | "75x120" | "120x75">("120x75");
  const [attempt, setAttempt] = useState(0);
  const [images, setImages] = useState<Record<string, "loaded" | "failed">>({});
  const key = (item: { key: string; label: LabelDto }) =>
    JSON.stringify([item.key, item.label.svg, output, attempt]);
  const ready =
    labels.length > 0 && labels.every((item) => images[key(item)] === "loaded");
  const failed = labels.some((item) => images[key(item)] === "failed");
  return {
    output,
    setOutput,
    key,
    ready,
    failed,
    loaded: (value: string) =>
      setImages((current) => ({ ...current, [value]: "loaded" })),
    fail: (value: string) =>
      setImages((current) => ({ ...current, [value]: "failed" })),
    retry: () => setAttempt((value) => value + 1),
  };
}
