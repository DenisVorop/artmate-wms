"use client";
import { useState } from "react";
import { ledgerFilterDefaults, type LedgerFilterValues } from "./ledger-filter";
export function useLedgerState() {
  const [filters, setFilters] =
    useState<LedgerFilterValues>(ledgerFilterDefaults);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  return {
    filters,
    page,
    setPage,
    apply: (values: LedgerFilterValues) => {
      setFilters(values);
      setPage(1);
    },
    expanded,
    setEventExpanded: (id: string, open: boolean) =>
      setExpanded((current) => {
        if (current.has(id) === open) return current;
        const next = new Set(current);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      }),
  };
}
