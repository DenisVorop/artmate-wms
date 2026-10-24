"use client";

import { useQuery } from "@tanstack/react-query";
import { getLabel } from "@/shared/api/generated/client";

export function useLocationLabel(id: string | null) {
  return useQuery({
    queryKey: ["location-label", id],
    queryFn: () => getLabel("location", id!),
    enabled: !!id,
    staleTime: 0,
  });
}
