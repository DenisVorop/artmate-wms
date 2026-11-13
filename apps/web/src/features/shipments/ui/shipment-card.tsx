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
  onAssign: (employeeId: string) => Promise<unknown>;
};
export function ShipmentCard({
  shipment,
  data,
  pending,
  onPrepare,
  onShip,
  onAssign,
}: Props) {
  const state = shipmentReadiness(data, shipment);
  const legacy = shipment.pickingMode !== "box" && !!shipment.employeeId;
  const ready = shipment.pickingMode === "box" && state.ready;
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
        <Badge
          tone={shipment.status === "shipped" || ready ? "success" : "warning"}
        >
          {shipment.status === "shipped"
            ? "Отправлена"
            : ready
              ? "Готова к отправке"
              : state.picked
                ? `Отобрано ${state.picked} из ${shipment.boxesRequested}`
                : "Короба зарезервированы"}
        </Badge>
      </div>
      <div className="ops-card-name">
        {shipment.wb
          ? `Поставка WB № ${shipment.wb.supplyId}`
          : data.skus.find((item) => item.id === shipment.skuId)?.name}
      </div>
      <div className="ops-description">
        {shipment.boxesRequested} коробов · {units} раскрасок
      </div>
      {shipment.wb ? (
        <div className="ops-sub">
          {data.employees.find((person) => person.id === shipment.employeeId)
            ?.name ?? "Свободное задание"}
          {state.picked > 0 && (
            <details>
              <summary>Отобранные короба и этикетки WB</summary>
              <ul>
                {shipment.wb.labels
                  .filter((label) => label.boxId)
                  .map((label) => (
                    <li key={label.id}>
                      {state.boxes.find((box) => box?.id === label.boxId)?.code}{" "}
                      · WB {label.id} ·{" "}
                      {data.employees.find(
                        (person) => person.id === label.employeeId,
                      )?.name ?? "Сотрудник"}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <div className="ops-sub">
          {state.boxes
            .map((box) => box?.code)
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {shipment.status === "draft" && (
        <>
          {shipment.wb && !ready && (
            <form
              className="ops-action-row"
              onSubmit={(event) => {
                event.preventDefault();
                const id = new FormData(event.currentTarget).get("employeeId");
                if (typeof id === "string" && id)
                  void onAssign(id).catch(() => {});
              }}
            >
              <select
                key={shipment.employeeId ?? "free"}
                name="employeeId"
                aria-label="Исполнитель отбора"
                defaultValue={shipment.employeeId ?? ""}
                required
              >
                <option value="">Выберите сотрудника</option>
                {data.employees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={pending}
              >
                Назначить
              </Button>
            </form>
          )}
          <ShipmentPallets
            shipment={shipment}
            data={data}
            pending={pending}
            onPrepare={onPrepare}
          />
          <p className={styles.dispatchHint}>
            {legacy
              ? "Завершите уже начатую отгрузку через QR её рабочей зоны."
              : ready
                ? "Все короба отобраны. Подтвердите отправку после передачи груза."
                : shipment.wb
                  ? "На рабочем экране сотрудник сканирует место, короб и этикетку WB."
                  : "Отсканируйте зарезервированные короба через рабочий экран."}
          </p>
          <div className="ops-action-row">
            {ready && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => void onShip().catch(() => {})}
              >
                Подтвердить отправку
                <ArrowUpRight size={14} />
              </Button>
            )}
            {!legacy && !ready && (
              <Link
                href={`/work?mode=shipping&shipmentId=${shipment.id}`}
                className="button button--secondary button--sm"
              >
                Открыть отбор
              </Link>
            )}
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
