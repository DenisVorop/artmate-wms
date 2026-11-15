"use client";
import { useState } from "react";

export function useTeamState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  return {
    createOpen,
    setCreateOpen,
    selectedId,
    setSelectedId,
    search,
    setSearch,
    status,
    setStatus,
  };
}
