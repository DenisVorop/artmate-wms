"use client";
import { useEffect, useRef, useState } from "react";
import { getAuthEpoch } from "@/shared/api/auth-memory";
import type { FirstScanDecision } from "./receipt-pallet-scan";
export function usePairScan(
  validate: (
    value: string,
  ) => boolean | FirstScanDecision | Promise<boolean | FirstScanDecision>,
  confirm: (first: string, address: string) => Promise<boolean>,
) {
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef(""),
    generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  return {
    first,
    error,
    reset: () => {
      generation.current++;
      firstRef.current = "";
      setFirst("");
      setError(null);
    },
    scan: async (value: string) => {
      setError(null);
      if (!firstRef.current) {
        const attempt = generation.current,
          epoch = getAuthEpoch();
        const result = await validate(value);
        if (
          !mounted.current ||
          attempt !== generation.current ||
          epoch !== getAuthEpoch()
        )
          return false;
        const accepted = typeof result === "boolean" ? result : result.accepted;
        if (!accepted) {
          setError(
            typeof result === "boolean"
              ? "Это другой объект. Сканируйте код, указанный в задании."
              : result.error,
          );
          return false;
        }
        firstRef.current = value.trim();
        setFirst(firstRef.current);
        return true;
      }
      return confirm(firstRef.current, value.trim());
    },
  };
}
