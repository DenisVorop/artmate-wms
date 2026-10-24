"use client";
import { useState } from "react";
import type { AdjustmentSnapshot } from "./adjustment-targets";
export function useAdjustmentState() {
  const [snapshot, setSnapshot] = useState<AdjustmentSnapshot | null>(null);
  const [confirming, setConfirming] = useState(false);
  return { snapshot, setSnapshot, confirming, setConfirming };
}
