"use client";
import { useState } from "react";
import type { PutawayTab } from "./putaway-queue";
export function usePutawayState() {
  const [tab, setTab] = useState<PutawayTab>("queued");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  return {
    tab,
    setTab,
    selectedId,
    setSelectedId,
    search,
    setSearch,
    notice,
    setNotice,
  };
}
