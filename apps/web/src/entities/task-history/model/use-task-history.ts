"use client";
import { useQuery } from "@tanstack/react-query";
import { getTaskHistory } from "@/shared/api/generated/client";
import type { GetTaskHistoryKind } from "@/shared/api/generated/model";

export function useTaskHistory(
  kind: GetTaskHistoryKind,
  id: string,
  page: number,
  open: boolean,
) {
  return useQuery({
    queryKey: ["task-history", kind, id, page],
    queryFn: ({ signal }) => getTaskHistory({ kind, id, page }, { signal }),
    enabled: open,
    refetchInterval: open ? 5000 : false,
    retry: 1,
  });
}
