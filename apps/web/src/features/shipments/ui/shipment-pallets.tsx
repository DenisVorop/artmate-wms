"use client";
import Link from "next/link";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
import type { shipmentReadiness } from "../lib/shipment-readiness";
import styles from "./shipments.module.css";

type Props = {
  readiness: ReturnType<typeof shipmentReadiness>;
  data: WorkspaceDto;
  pending: boolean;
  onPrepare: (palletId: string) => void;
};
export function ShipmentPallets({
  readiness,
  data,
  pending,
  onPrepare,
}: Props) {
  const missing = readiness.boxes.some(
    (box) => !box || (box.status !== "staged" && !box.palletId),
  );
  if (!readiness.pallets.length && !missing) return null;
  return (
    <section className={styles.pallets} aria-labelledby="shipment-pallets">
      <h3 id="shipment-pallets">Паллеты</h3>
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
              Адрес{" "}
              <strong>
                {location?.code ??
                  (pallet.status === "in_transit" ? "в пути" : "не назначен")}
              </strong>
              {held && (
                <span>
                  Возврат <strong>{held.code}</strong>
                </span>
              )}
            </div>
            {requiresPutaway ? (
              <Link href="/putaway" className={styles.textLink}>
                Разместить короба
              </Link>
            ) : movement ? (
              <Link href="/movements" className={styles.textLink}>
                {movement.status === "in_transit"
                  ? "Паллета в пути"
                  : "Перемещение запланировано"}
              </Link>
            ) : ready ? (
              <p className={styles.ready}>Готова к отбору</p>
            ) : location?.kind === "rack" && location.level > 2 ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || pallet.status !== "stored" || putawayHold}
                onClick={() => onPrepare(pallet.id)}
              >
                Спустить паллету
              </Button>
            ) : null}
            {putawayHold && (
              <p className={styles.note}>
                Сначала завершите размещение коробов на эту паллету.
              </p>
            )}
          </div>
        );
      })}
      {missing && (
        <p className={styles.note}>
          Часть коробов ещё не на паллетах хранения.
        </p>
      )}
    </section>
  );
}
