import { z } from "zod";
export const shipmentSchema = z.object({
  skuId: z.string().min(1, "Выберите тематику"),
  boxesRequested: z.number().int().min(1).max(10000),
});
export type ShipmentValues = z.infer<typeof shipmentSchema>;
export function buildShipment(v: ShipmentValues) {
  return { ...v, requestId: crypto.randomUUID() };
}

export const preparationSchema = z.object({
  palletId: z.string().min(1),
  toLocationId: z.string().min(1, "Выберите свободный адрес отбора"),
  employeeId: z.string().min(1, "Выберите сотрудника на смене"),
});
export type PreparationValues = z.infer<typeof preparationSchema>;
export function buildPreparation(values: PreparationValues) {
  return {
    ...values,
    kind: "lower" as const,
    keepSourceReserved: true,
    requestId: crypto.randomUUID(),
  };
}
