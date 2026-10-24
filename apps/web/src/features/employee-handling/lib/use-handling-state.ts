"use client";
import { useEffect, useState } from "react";
export function useHandlingState(candidateId?: string) {
  const [selectedId, setSelectedId] = useState<string | null>(
    candidateId ?? null,
  );
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!selectedId && !done && candidateId) setSelectedId(candidateId);
  }, [candidateId, selectedId, done]);
  return {
    selectedId,
    setSelectedId,
    done,
    setDone,
    next: () => {
      setSelectedId(null);
      setDone(false);
    },
  };
}
