"use client";
import { useState } from "react";
export function useInventoryFilter() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState("summary");
  return { search, setSearch, view, setView };
}
