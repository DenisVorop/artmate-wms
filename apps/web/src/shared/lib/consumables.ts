import type { ConsumableQuantityDto } from "@/shared/api/generated/model";

export const consumableNames = {
  individual_box: "Поштучные коробки",
  transport_carton: "Транспортные короба",
} satisfies Record<ConsumableQuantityDto["item"], string>;

export function packagingForNextBox(reservations: ConsumableQuantityDto[]) {
  const remaining = { individual_box: 20, transport_carton: 1 };
  return reservations.flatMap((row) => {
    const quantity = Math.min(row.quantity, remaining[row.item]);
    remaining[row.item] -= quantity;
    return quantity ? [{ ...row, quantity }] : [];
  });
}
