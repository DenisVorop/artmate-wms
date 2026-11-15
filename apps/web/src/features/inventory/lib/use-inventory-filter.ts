"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
export function useInventoryFilter() {
  const [search, setSearch] = useState("");
  const requestedView = useSearchParams().get("view");
  const initialView = requestedView === "boxes" ? "boxes" : "summary";
  const [view, setView] = useState<string>(initialView);
  useEffect(() => setView(initialView), [initialView]);
  return { search, setSearch, view, setView };
}
