"use client";
import Link from "next/link";
import { ArrowDownToLine, ArrowRight, CheckCircle2 } from "lucide-react";
import type { ShipmentDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
import { shipmentReadiness } from "../lib/shipment-readiness";
import styles from "./shipments.module.css";

type Props = {
  shipment: ShipmentDto;
  data: WorkspaceDto;
  pending: boolean;
  onPrepare: (palletId: string) => void;
};
export function ShipmentPallets({ shipment, data, pending, onPrepare }: Props) {
  const readiness = shipmentReadiness(data, shipment);
  return (
    <div className={styles.pallets}>
      {readiness.pallets.map((pallet) => {
        const location = data.locations.find(
          (item) => item.id === pallet.locationId,
        );
        const held = data.locations.find(
          (item) => item.id === pallet.returnLocationId,
        );
        const movement = data.movements.find(
          (item) =>
            item.palletId === pallet.id &&
            ["planned", "in_transit"].includes(item.status),
        );
        const putawayHold = data.putawayTasks.some(
          (task) =>
            ["claimed", "in_transit"].includes(task.status) &&
            task.toLocationId === pallet.locationId,
        );
        const requiresPutaway =
          pallet.kind === "assembly" ||
          location?.kind === "assembly" ||
          readiness.boxes.some(
            (box) =>
              box?.palletId === pallet.id &&
              data.putawayTasks.some(
                (task) => task.boxId === box.id && task.status !== "completed",
              ),
          );
        const ready =
          !requiresPutaway &&
          pallet.status === "stored" &&
          !!location &&
          ["picking", "shipping"].includes(location.kind);
        const count = readiness.boxes.filter(
          (box) => box?.palletId === pallet.id,
        ).length;
        return (
          <div className={styles.pallet} key={pallet.id}>
            <div className={styles.palletHeading}>
              <strong>{pallet.code}</strong>
              <span>
                {count} из {pallet.quantity} кор. в эту отгрузку
              </span>
            </div>
            <div className={styles.palletAddress}>
              Адрес:{" "}
              <strong>
                {location?.code ??
                  (pallet.status === "in_transit" ? "в пути" : "не назначен")}
              </strong>
              {held && (
                <span>
                  Возврат: <strong>{held.code}</strong>
                </span>
              )}
            </div>
            {requiresPutaway ? (
              <Link href="/putaway" className="text-link">
                Сначала разместите короба по тематикам <ArrowRight size={14} />
              </Link>
            ) : movement ? (
              <Link href="/movements" className="text-link">
                {movement.status === "in_transit"
                  ? "Паллета в пути — подтвердить размещение"
                  : "Перемещение запланировано — выполнить задание"}
                <ArrowRight size={14} />
              </Link>
            ) : ready ? (
              <div className={styles.ready}>
                <CheckCircle2 size={14} />
                Готова к отбору
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || pallet.status !== "stored" || putawayHold}
                onClick={() => onPrepare(pallet.id)}
              >
                <ArrowDownToLine size={14} />
                Подготовить к отгрузке
              </Button>
            )}
            {putawayHold && (
              <p className={styles.note}>
                Паллета ожидает размещение зарезервированных коробов. Завершите
                его перед перемещением.
              </p>
            )}
          </div>
        );
      })}
      {readiness.boxes.some((box) => !box?.palletId) && (
        <p className={styles.note}>
          Часть коробов находится в размещении или без паллеты. Завершите
          размещение перед отправкой.
        </p>
      )}
    </div>
  );
}
