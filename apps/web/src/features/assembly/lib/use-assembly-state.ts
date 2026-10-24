"use client";
import { useState } from "react";
import type { QueueTab } from "./assembly-queue";
export function useAssemblyState() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actorId, setActorId] = useState("");
  const [tab, setTab] = useState<QueueTab>("free");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  return {
    selectedId,
    setSelectedId,
    creating,
    setCreating,
    actorId,
    setActorId,
    tab,
    setTab,
    search,
    setSearch,
    notice,
    setNotice,
  };
}
