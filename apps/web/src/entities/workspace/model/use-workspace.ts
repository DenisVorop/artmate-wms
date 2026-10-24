"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspace } from "@/shared/api/generated/client";
import { newestWorkspace } from "@/shared/api/workspace-shape";
import { workspaceQueryKey } from "@/shared/api/query-keys";
export function useWorkspace() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: async () => {
      const result = newestWorkspace(
        await getWorkspace(),
        client.getQueryData(workspaceQueryKey),
      );
      if (!result)
        throw new Error(
          "Не удалось прочитать актуальные данные склада. Обновите страницу.",
        );
      return result;
    },
    refetchInterval: 5000,
    retry: 1,
  });
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  };
}
