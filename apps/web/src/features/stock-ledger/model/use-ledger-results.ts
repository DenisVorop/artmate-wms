"use client";
import { useMemo } from "react";
import { useStockLedger } from "@/entities/stock-ledger";
import { ledgerQuery, type LedgerFilterValues } from "../lib/ledger-filter";
export function useLedgerResults(filters: LedgerFilterValues, page: number) {
  const params = useMemo(() => ledgerQuery(filters, page), [filters, page]);
  return useStockLedger(params);
}
