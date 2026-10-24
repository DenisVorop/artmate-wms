"use client";
import { useState } from "react";
export function usePackagingState() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return { selectedId, setSelectedId };
}
