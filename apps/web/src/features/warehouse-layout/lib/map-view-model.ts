import {
  BoxDtoStatus,
  MovementDtoStatus,
  PalletDtoStatus,
  LocationDtoKind,
} from "@/shared/api/generated/model";
import type {
  LocationDto,
  RackSectionDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

/** Presentation projection: one drawing per section, one drawing per standalone address. */
export type MapObject = {
  id: string;
  code: string;
  name: string;
  kind: LocationDto["kind"];
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  section?: RackSectionDto;
  addresses: LocationDto[];
};

/** Select the created identity, never an archived predecessor with the same geometry. */
export function selectSavedCanvasObject<
  T extends { id: string; archived: boolean },
>(
  items: readonly T[],
  beforeIds: ReadonlySet<string>,
  matches: (item: T) => boolean,
  updatedId?: string,
): T | undefined {
  if (updatedId) return items.find((item) => item.id === updatedId);
  const activeMatches = items.filter((item) => !item.archived && matches(item));
  return (
    activeMatches.find((item) => !beforeIds.has(item.id)) ?? activeMatches[0]
  );
}
export function mapObjects(data: WorkspaceDto): MapObject[] {
  return [
    ...data.sections
      .filter((section) => !section.archived)
      .map((section) => ({
        ...section,
        id: `section:${section.id}`,
        kind: LocationDtoKind.rack,
        section,
        addresses: data.locations
          .filter(
            (location) =>
              !location.archived && location.sectionId === section.id,
          )
          .sort((a, b) => a.level - b.level),
      })),
    ...data.locations
      .filter((location) => !location.archived && location.sectionId === null)
      .map((location) => ({
        ...location,
        id: `location:${location.id}`,
        addresses: [location],
      })),
  ];
}
export function addressInventory(data: WorkspaceDto, ids: string[]) {
  const pallets = data.pallets.filter(
    (pallet) =>
      pallet.status === PalletDtoStatus.stored &&
      pallet.locationId !== null &&
      ids.includes(pallet.locationId),
  );
  const boxes = data.boxes.filter(
    (box) =>
      box.status === BoxDtoStatus.stored &&
      box.locationId !== null &&
      ids.includes(box.locationId),
  );
  const incoming = data.movements.filter(
    (movement) =>
      (movement.status === MovementDtoStatus.planned ||
        movement.status === MovementDtoStatus.in_transit) &&
      ids.includes(movement.toLocationId),
  );
  const returnPallets = data.pallets.filter(
    (pallet) =>
      pallet.status !== PalletDtoStatus.retired &&
      pallet.returnLocationId !== null &&
      ids.includes(pallet.returnLocationId),
  );
  const incomingPutaways = data.putawayTasks.filter(
    (task) =>
      ["claimed", "in_transit"].includes(task.status) &&
      task.toLocationId !== null &&
      ids.includes(task.toLocationId),
  );
  const additionalHolds = (data.addressHolds ?? []).filter(
    (hold, index, all) =>
      all.findIndex(
        (item) =>
          item.locationId === hold.locationId && item.kind === hold.kind,
      ) === index &&
      ids.includes(hold.locationId) &&
      !(hold.kind === "movement"
        ? incoming.some((item) => item.toLocationId === hold.locationId)
        : hold.kind === "putaway"
          ? incomingPutaways.some(
              (item) => item.toLocationId === hold.locationId,
            )
          : returnPallets.some(
              (item) => item.returnLocationId === hold.locationId,
            )),
  );
  return {
    pallets,
    boxes,
    incoming,
    incomingPutaways,
    additionalHolds,
    returnPallets,
    occupied: pallets.length > 0 || boxes.length > 0,
    reserved:
      additionalHolds.length > 0 ||
      incoming.length > 0 ||
      incomingPutaways.length > 0 ||
      returnPallets.length > 0,
  };
}
export function addressAvailability(
  data: WorkspaceDto,
  address: LocationDto,
): string {
  const inventory = addressInventory(data, [address.id]);
  if (address.archived) return "В корзине";
  if (address.blocked) return "Закрыто";
  if (inventory.occupied)
    return inventory.pallets.some((pallet) => pallet.quantity === 0)
      ? "Паллета на месте"
      : "Занято";
  if (inventory.incomingPutaways.length)
    return `Резерв: ${inventory.incomingPutaways.length} кор.`;
  if (inventory.incoming.length) return "Ожидает паллету";
  if (inventory.returnPallets.length) return "Резерв возврата";
  if (inventory.additionalHolds.some((hold) => hold.kind === "putaway"))
    return "Резерв размещения короба";
  if (inventory.additionalHolds.some((hold) => hold.kind === "movement"))
    return "Ожидает паллету";
  if (inventory.additionalHolds.length) return "Резерв возврата";
  return "Свободно";
}
