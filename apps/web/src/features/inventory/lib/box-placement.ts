import type {
  BoxDto,
  LocationDto,
  PalletDto,
} from "@/shared/api/generated/model";

export function boxPlacement(
  data: {
    locations: Pick<LocationDto, "id" | "code" | "kind">[];
    pallets: Pick<PalletDto, "id" | "kind" | "status">[];
  },
  box: Pick<BoxDto, "status" | "locationId" | "palletId">,
) {
  const address = data.locations.find(
    (location) => location.id === box.locationId,
  )?.code;
  if (box.status === "shipped")
    return {
      address: address ?? "—",
      status: "Отгружен",
      tone: "neutral" as const,
    };
  if (box.status === "in_transit")
    return {
      address: "У сотрудника",
      status: "В размещении",
      tone: "warning" as const,
    };
  const pallet = data.pallets.find((item) => item.id === box.palletId);
  const location = data.locations.find((item) => item.id === box.locationId);
  if (pallet?.kind === "assembly" || location?.kind === "assembly")
    return {
      address: address ?? "—",
      status: "На накоплении",
      tone: "warning" as const,
    };
  if (pallet?.status === "in_transit")
    return {
      address: "В пути",
      status: "В перемещении",
      tone: "warning" as const,
    };
  if (!address)
    return {
      address: "—",
      status: "Адрес не назначен",
      tone: "warning" as const,
    };
  return { address, status: "На хранении", tone: "success" as const };
}
