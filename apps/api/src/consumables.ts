import { BadRequestException } from "@nestjs/common";
import {
  consumableItems,
  type ConsumableItem,
  type ConsumableQuantityDto,
  type WorkspaceDto,
} from "./dto";

export const consumableNames: Record<ConsumableItem, string> = {
  individual_box: "Поштучные коробки",
  transport_carton: "Транспортные короба",
};
export const consumablesPerBox: Record<ConsumableItem, number> = {
  individual_box: 20,
  transport_carton: 1,
};

export function needsConsumables(unitsPerBox: number) {
  return unitsPerBox === consumablesPerBox.individual_box;
}

export function hasConsumables(state: WorkspaceDto, locationId: string) {
  return (
    state.warehouse?.consumables?.some(
      (row) => row.locationId === locationId,
    ) ?? false
  );
}

export function reservedConsumables(state: WorkspaceDto) {
  const byAddress = new Map<string, number>();
  for (const task of state.tasks) {
    if (task.status === "completed") continue;
    for (const row of task.consumableReservations ?? []) {
      const key = consumableKey(row);
      byAddress.set(key, (byAddress.get(key) ?? 0) + row.quantity);
    }
  }
  return byAddress;
}

export function consumableKey(
  row: Pick<ConsumableQuantityDto, "locationId" | "item">,
) {
  return `${row.locationId}/${row.item}`;
}

function freeConsumables(state: WorkspaceDto) {
  const reserved = reservedConsumables(state);
  return (state.warehouse?.consumables ?? []).map((row) => ({
    ...row,
    quantity: row.quantity - (reserved.get(consumableKey(row)) ?? 0),
  }));
}

export function consumableTaskCapacity(state: WorkspaceDto) {
  if (!state.warehouse?.consumablesEnabled) return Infinity;
  const free = freeConsumables(state);
  return Math.min(
    ...consumableItems.map((item) =>
      Math.floor(
        free.reduce(
          (total, row) => total + (row.item === item ? row.quantity : 0),
          0,
        ) / consumablesPerBox[item],
      ),
    ),
  );
}

export function reserveConsumables(
  state: WorkspaceDto,
  unitsPerBox: number,
  boxes: number,
) {
  if (!state.warehouse?.consumablesEnabled || !needsConsumables(unitsPerBox))
    return undefined;
  const codes = new Map(
    state.locations.map((location) => [location.id, location.code]),
  );
  const free = freeConsumables(state).sort(
    (a, b) =>
      (codes.get(a.locationId) ?? "").localeCompare(
        codes.get(b.locationId) ?? "",
        "ru",
        { numeric: true },
      ) || a.locationId.localeCompare(b.locationId),
  );
  const result: ConsumableQuantityDto[] = [];
  for (const item of consumableItems) {
    let needed = consumablesPerBox[item] * boxes;
    for (const row of free) {
      if (!needed) break;
      if (row.item !== item || row.quantity <= 0) continue;
      const quantity = Math.min(needed, row.quantity);
      result.push({ ...row, quantity });
      needed -= quantity;
    }
    if (needed)
      throw new BadRequestException(
        `Не хватает упаковки. ${consumableNames[item]}: нужно ещё ${needed} шт.`,
      );
  }
  return result;
}

export function consumeReservedPackaging(
  state: WorkspaceDto,
  reservations: ConsumableQuantityDto[],
) {
  const remaining: ConsumableQuantityDto[] = [];
  const used: ConsumableQuantityDto[] = [];
  const stock = new Map(
    (state.warehouse.consumables ?? []).map((row) => [consumableKey(row), row]),
  );
  for (const item of consumableItems) {
    let needed = consumablesPerBox[item];
    for (const row of reservations) {
      if (row.item !== item) continue;
      const quantity = Math.min(needed, row.quantity);
      if (quantity > 0) {
        const entry = stock.get(consumableKey(row));
        if (!entry || entry.quantity < quantity)
          throw new BadRequestException(
            "Упаковки нет по зарезервированному адресу",
          );
        entry.quantity -= quantity;
        used.push({ ...row, quantity });
        needed -= quantity;
      }
      if (row.quantity > quantity)
        remaining.push({ ...row, quantity: row.quantity - quantity });
    }
    if (needed)
      throw new BadRequestException(
        "Для задания не зарезервирован полный комплект упаковки",
      );
  }
  state.warehouse.consumables = [...stock.values()].filter(
    (row) => row.quantity > 0,
  );
  return { remaining, used };
}
