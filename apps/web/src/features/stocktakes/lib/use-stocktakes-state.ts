"use client";
import { useCallback, useState } from "react";

export function useStocktakesState(initialDocumentId?: string) {
  const [selectedId, setSelectedId] = useState(initialDocumentId ?? "");
  const [archive, setArchive] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(() => new Set());
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const select = (id: string) => {
    if (id === selectedId) return;
    if (dirtyRows.size) {
      setPendingSelection(id);
      return;
    }
    setSelectedId(id);
    setNotice(null);
  };
  const forceSelect = () => {
    if (pendingSelection !== null) {
      setSelectedId(pendingSelection);
      setPendingSelection(null);
      setDirtyRows(new Set());
      setNotice(null);
    }
  };
  const setRowDirty = useCallback(
    (id: string, dirty: boolean) =>
      setDirtyRows((current) => {
        if (current.has(id) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const showArchive = (value: boolean) => {
    setArchive(value);
    setPage(1);
    setSearch("");
  };
  return {
    selectedId,
    setSelectedId,
    archive,
    showArchive,
    page,
    setPage,
    search,
    setSearch,
    creating,
    setCreating,
    dirtyRows,
    setRowDirty,
    pendingSelection,
    setPendingSelection,
    notice,
    setNotice,
    select,
    forceSelect,
  };
}
