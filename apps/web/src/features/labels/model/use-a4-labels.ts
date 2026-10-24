"use client";
import { useQuery } from "@tanstack/react-query";
import { getLabel } from "@/shared/api/generated/client";
import { readA4Labels, type A4LabelItem } from "../lib/a4-labels";

export function useA4Labels(
  scope: string,
  items: A4LabelItem[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["a4-labels", scope, items],
    queryFn: ({ signal }) =>
      readA4Labels(
        items,
        (type, id, signal) => getLabel(type, id, { signal }),
        signal,
      ),
    enabled: enabled && items.length > 0,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
