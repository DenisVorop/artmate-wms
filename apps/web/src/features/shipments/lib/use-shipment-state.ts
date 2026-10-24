"use client";
import { useState } from "react";
export function useShipmentState() {
  const [notice, setNotice] = useState("");
  const [preparingId, setPreparingId] = useState<string | null>(null);
  return { notice, setNotice, preparingId, setPreparingId };
}
