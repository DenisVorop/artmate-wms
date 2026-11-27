import { z } from "zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";

export const boxTransferSchema = z
  .object({
    fromLocationId: z.string().min(1, "Выберите исходный адрес"),
    toLocationId: z.string().min(1, "Выберите адрес назначения"),
    zoneId: z.string().min(1, "Выберите зону размещения"),
    boxIds: z.array(z.string()).min(1, "Выберите короба").max(100),
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    path: ["toLocationId"],
    message: "Выберите другой адрес",
  });
export type BoxTransferValues = z.infer<typeof boxTransferSchema>;

export function transferableBoxes(data: WorkspaceDto) {
  return data.boxes.filter((box) => {
    const pallet = data.pallets.find((item) => item.id === box.palletId);
    const location = data.locations.find((item) => item.id === box.locationId);
    return (
      box.status === "stored" &&
      pallet?.kind === "finished" &&
      pallet.status === "stored" &&
      !!location &&
      !location.archived &&
      !location.blocked &&
      ["floor", "rack"].includes(location.kind) &&
      !data.putawayTasks.some(
        (task) => task.boxId === box.id && task.status !== "completed",
      ) &&
      !data.shipments.some(
        (shipment) =>
          shipment.status === "draft" && shipment.boxIds.includes(box.id),
      ) &&
      !data.movements.some(
        (movement) =>
          movement.palletId === pallet.id &&
          ["planned", "in_transit"].includes(movement.status),
      )
    );
  });
}
