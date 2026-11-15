"use client";
import { useState } from "react";
import type { PutawayFilter } from "./putaway-queue";
export function usePutawayState() {
  const [filter, setFilter] = useState<PutawayFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  return {
    filter,
    setFilter,
    selectedId,
    setSelectedId,
    search,
    setSearch,
    notice,
    setNotice,
  };
}
