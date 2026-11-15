"use client";
import { useState } from "react";
export function useReceivingState() {
  const [view, setView] = useState<"active" | "archive">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [placing, setPlacing] = useState<{
    receiptId: string;
    palletId: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  return {
    view,
    setView,
    selectedId,
    setSelectedId,
    creating,
    setCreating,
    placing,
    setPlacing,
    search,
    setSearch,
    notice,
    setNotice,
  };
}
