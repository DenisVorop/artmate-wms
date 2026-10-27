"use client";
import { useQuery } from "@tanstack/react-query";
import type { StocktakeDto } from "@/shared/api/generated/model";
import { getLabel } from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { openingLabelPage, loadOpeningLabelPage } from "../lib/opening-labels";
export function useOpeningLabels(
  doc: StocktakeDto | undefined,
  locationId: string,
  page: number,
) {
  const scope = getAuthIdentityScope(),
    epoch = getAuthEpoch();
  return useQuery({
    queryKey: [
      "opening-labels",
      scope,
      epoch,
      doc?.id,
      doc?.revision,
      locationId,
      page,
    ],
    enabled: !!doc && !!locationId,
    queryFn: async ({ signal }) => {
      const selected = openingLabelPage(doc!, locationId, page);
      const labels = await loadOpeningLabelPage(
        selected.refs,
        (ref) => getLabel(ref.type, ref.id, { signal }),
        signal,
      );
      if (scope !== getAuthIdentityScope() || epoch !== getAuthEpoch())
        throw new Error("Сессия изменилась. Откройте этикетки заново.");
      return { ...selected, labels };
    },
    retry: false,
  });
}
