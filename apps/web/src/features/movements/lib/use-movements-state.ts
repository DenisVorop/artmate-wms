"use client";
import { useState } from "react";
export function useMovementsState() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [retireId, setRetireId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("active");
  return {
    selectedId,
    setSelectedId,
    creating,
    setCreating,
    retireId,
    setRetireId,
    notice,
    setNotice,
    filter,
    setFilter,
  };
}
