"use client";
import { useState } from "react";
import type { RollLabelFormat } from "@/shared/lib/label-paper";
import type { PalletLabelDto } from "@/shared/api/generated/model";
export function usePalletLabelState(scope: string) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [format, setFormat] = useState<RollLabelFormat>("75x120");
  const [attempt, setAttempt] = useState(0);
  const [images, setImages] = useState<Record<string, "loaded" | "failed">>({});
  const key = (item: PalletLabelDto) =>
    JSON.stringify([
      scope,
      selectedId,
      page,
      pageSize,
      item.id,
      item.code,
      item.payload,
      item.svg,
      attempt,
    ]);
  return {
    selectedId,
    historyPage,
    setHistoryPage,
    page,
    setPage,
    pageSize,
    format,
    setFormat,
    key,
    select: (id: string) => {
      setSelectedId(id);
      setPage(1);
      setImages({});
    },
    changeSize: (size: number) => {
      setPageSize(size);
      setPage(1);
      setImages({});
    },
    loaded: (value: string) =>
      setImages((current) => ({ ...current, [value]: "loaded" })),
    failed: (value: string) =>
      setImages((current) => ({ ...current, [value]: "failed" })),
    imageReady: (item: PalletLabelDto) => images[key(item)] === "loaded",
    imageFailed: (item: PalletLabelDto) => images[key(item)] === "failed",
    retryImages: () => setAttempt((value) => value + 1),
  };
}
