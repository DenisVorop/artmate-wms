"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getStocktakes } from "@/shared/api/generated/client";
import { stocktakeQueryKey } from "@/shared/api/query-keys";
import type { StocktakeSummaryDto } from "@/shared/api/generated/model";

/** Paginated supplementary documents; never imply the first page is the whole queue. */
export function useWorkQueueStocktakes(
  bucket: "active" | "archive" = "active",
  enabled = true,
) {
  const query = useInfiniteQuery({
    queryKey: [...stocktakeQueryKey, "work-queue", bucket],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      getStocktakes({ bucket, pageSize: 100, page: pageParam }, { signal }),
    getNextPageParam: (page) =>
      page.page * page.pageSize < page.total ? page.page + 1 : undefined,
    refetchInterval: 5000,
    retry: 1,
  });
  const documents = new Map<string, StocktakeSummaryDto>();
  for (const page of query.data?.pages ?? [])
    for (const item of page.items) {
      const previous = documents.get(item.id);
      if (!previous || item.revision >= previous.revision)
        documents.set(item.id, item);
    }
  return {
    ...query,
    items: [...documents.values()],
    total: query.data?.pages[0]?.total ?? 0,
  };
}
