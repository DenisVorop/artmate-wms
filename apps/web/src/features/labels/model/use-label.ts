"use client";
import { useQuery } from "@tanstack/react-query";
import { getLabel } from "@/shared/api/generated/client";

export type LabelType = Parameters<typeof getLabel>[0];
export function useLabel(type: LabelType, id: string) {
  return useQuery({
    queryKey: ["label", type, id],
    queryFn: () => getLabel(type, id),
    retry: false,
  });
}
