"use client";
import { useState } from "react";
import type { QueueFilter } from "./assembly-queue";
export function useAssemblyState() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  return {
    selectedId,
    setSelectedId,
    creating,
    setCreating,
    filter,
    setFilter,
    search,
    setSearch,
    notice,
    setNotice,
  };
}
