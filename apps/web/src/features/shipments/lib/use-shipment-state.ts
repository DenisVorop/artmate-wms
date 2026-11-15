"use client";
import { useState } from "react";
import type { ShipmentFilter } from "./shipment-list";

export function useShipmentState() {
  const [notice, setNotice] = useState("");
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"manual" | "wb" | null>(null);
  const [filter, setFilter] = useState<ShipmentFilter>("active");
  const [search, setSearch] = useState("");

  return {
    notice,
    setNotice,
    preparingId,
    setPreparingId,
    selectedId,
    setSelectedId,
    createMode,
    setCreateMode,
    filter,
    setFilter,
    search,
    setSearch,
  };
}
