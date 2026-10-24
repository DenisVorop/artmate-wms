"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, RotateCcw } from "lucide-react";
import type { ShipmentDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import { shipmentReadiness } from "../lib/shipment-readiness";
import { ShipmentPallets } from "./shipment-pallets";
import styles from "./shipments.module.css";

type Props = {
  shipment: ShipmentDto;
  data: WorkspaceDto;
  pending: boolean;
  onPrepare: (palletId: string) => void;
  onShip: () => Promise<unknown>;
};
export function ShipmentCard({
  shipment,
  data,
  pending,
  onPrepare,
  onShip,
}: Props) {
  const state = shipmentReadiness(data, shipment);
  const units = state.boxes.reduce((sum, box) => sum + (box?.units ?? 0), 0);
  const hasRemainder = state.pallets.some(
    (pallet) =>
      pallet.quantity > 0 &&
      (pallet.returnLocationId ||
        data.locations.some(
          (location) =>
            !location.archived &&
            location.id === pallet.locationId &&
            ["picking", "shipping"].includes(location.kind),
        )),
  );
  const hasEmptyPallet = state.pallets.some(
    (pallet) => pallet.status === "stored" && pallet.quantity === 0,
  );
  return (
    <article className="ops-task-card">
      <div className="ops-card-top">
        <span className="ops-mono">{shipment.code}</span>
        <Badge tone={shipment.status === "shipped" ? "success" : "warning"}>
          {shipment.status === "shipped"
            ? "Отправлена"
            : "Короба зарезервированы"}
        </Badge>
      </div>
      <div className="ops-card-name">
        {data.skus.find((item) => item.id === shipment.skuId)?.name}
      </div>
      <div className="ops-description">
        {shipment.boxesRequested} коробов · {units} раскрасок
      </div>
      <div className="ops-sub">
        {state.boxes
          .map((box) => box?.code)
          .filter(Boolean)
          .join(" · ")}
      </div>
      {shipment.status === "draft" && (
        <>
          <ShipmentPallets
            shipment={shipment}
            data={data}
            pending={pending}
            onPrepare={onPrepare}
          />
          <p className={styles.dispatchHint}>
            {state.ready
              ? "Все выбранные короба находятся в зоне отбора или отгрузки. Можно подтвердить отправку."
              : "Отправка станет доступна после подтверждённого размещения всех выбранных коробов в зоне отбора или отгрузки."}
          </p>
          <div className="ops-action-row">
            <Button
              size="sm"
              disabled={pending || !state.ready}
              onClick={() => void onShip().catch(() => {})}
            >
              Подтвердить отправку
              <ArrowUpRight size={14} />
            </Button>
            <Link href="/movements" className="button button--ghost button--sm">
              Перемещения
              <ArrowRight size={14} />
            </Link>
          </div>
        </>
      )}
      {shipment.status === "shipped" && hasRemainder && (
        <Link href="/movements" className={styles.returnLink}>
          <RotateCcw size={14} />
          Вернуть остаток на хранение
          <ArrowRight size={14} />
        </Link>
      )}
      {shipment.status === "shipped" && hasEmptyPallet && (
        <Link href="/movements" className={styles.returnLink}>
          Подтвердить вывоз пустого поддона
          <ArrowRight size={14} />
        </Link>
      )}
    </article>
  );
}
