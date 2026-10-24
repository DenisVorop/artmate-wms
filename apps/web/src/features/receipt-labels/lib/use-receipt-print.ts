"use client";
import { useState } from "react";

export function useReceiptPrint(receiptId: string) {
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState(0);
  const key = (palletId: string) => `${receiptId}:${version}:${palletId}`;
  const markLoaded = (palletId: string) => {
    setLoaded((current) => ({ ...current, [key(palletId)]: true }));
    setFailed((current) => ({ ...current, [key(palletId)]: false }));
  };
  const markFailed = (palletId: string) => {
    setFailed((current) => ({ ...current, [key(palletId)]: true }));
  };
  return {
    key,
    markLoaded,
    markFailed,
    isLoaded: (palletId: string) => loaded[key(palletId)] === true,
    isFailed: (palletId: string) => failed[key(palletId)] === true,
    retryImages: () => setVersion((current) => current + 1),
    print: () => window.print(),
  };
}
