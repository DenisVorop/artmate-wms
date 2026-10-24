"use client";
import { useState } from "react";
export function usePairScan(
  validate: (value: string) => boolean,
  confirm: (first: string, address: string) => Promise<boolean>,
) {
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  return {
    first,
    error,
    reset: () => {
      setFirst("");
      setError(null);
    },
    scan: async (value: string) => {
      setError(null);
      if (!first) {
        if (!validate(value)) {
          setError("Это другой объект. Сканируйте код, указанный в задании.");
          return false;
        }
        setFirst(value.trim());
        return true;
      }
      return confirm(first, value.trim());
    },
  };
}
