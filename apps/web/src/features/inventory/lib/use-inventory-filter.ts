"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export type InventoryView = "summary" | "pallets" | "boxes";

export function useInventoryFilter() {
  const [search, setSearch] = useState("");
  const requestedView = useSearchParams().get("view");
  const initialView =
    requestedView === "boxes" || requestedView === "pallets"
      ? requestedView
      : "summary";
  const [view, setView] = useState<InventoryView>(initialView);
  useEffect(() => setView(initialView), [initialView]);
  return { search, setSearch, view, setView };
}
