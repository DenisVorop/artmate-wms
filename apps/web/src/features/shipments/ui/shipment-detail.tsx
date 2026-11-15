"use client";
import Link from "next/link";
import type { ShipmentDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Badge, Button, Select } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import { shipmentStatus } from "../lib/shipment-list";
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

export function ShipmentDetail({
  shipment,
  data,
  pending,
  onPrepare,
  onShip,
  onAssign,
}: Props) {
  const state = shipmentReadiness(data, shipment);
  const boxesById = new Map(
    state.boxes.flatMap((box) => (box ? [[box.id, box]] : [])),
  );
  const employees = new Map(
    data.employees.map((person) => [person.id, person.name]),
  );
  const legacy = shipment.pickingMode !== "box" && !!shipment.employeeId;
  const ready = shipment.pickingMode === "box" && state.ready;
  const shipped = shipment.status === "shipped";
  const units = state.boxes.every(Boolean)
    ? state.boxes.reduce((sum, box) => sum + (box?.units ?? 0), 0)
    : null;
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
  const assigned = shipment.employeeId
    ? employees.get(shipment.employeeId)
    : undefined;
  const labels = shipment.wb?.labels.filter((label) => label.boxId) ?? [];

  return (
    <section
      className={`glass-panel ${styles.detail}`}
      aria-label={`Отгрузка ${shipment.code}`}
    >
      <header className={styles.detailHeader}>
        <div>
          <h2>
            {shipment.wb
              ? `Поставка WB № ${shipment.wb.supplyId}`
              : (data.skus.find((item) => item.id === shipment.skuId)?.name ??
                "Товар недоступен")}
          </h2>
          <p>
            {shipment.code} · {number(shipment.boxesRequested)} кор.
            {units !== null && <> · {number(units)} шт.</>}
            {assigned && <> · {assigned}</>}
            {!shipped && shipment.pickingMode === "box" && (
              <>
                {" "}
                · Отобрано {number(state.picked)} из{" "}
                {number(shipment.boxesRequested)}
              </>
            )}
          </p>
        </div>
        <Badge tone={shipped || ready ? "success" : "neutral"}>
          {shipmentStatus(shipment, ready)}
        </Badge>
      </header>
      {labels.length > 0 && (
        <details className={styles.boxList}>
          <summary>Отобранные короба и этикетки WB</summary>
          <ul>
            {labels.map((label) => (
              <li key={label.id}>
                {boxesById.get(label.boxId ?? "")?.code ?? "Короб недоступен"}
                {" · WB "}
                {label.id}
                {label.employeeId && employees.has(label.employeeId) && (
                  <> · {employees.get(label.employeeId)}</>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!shipment.wb && boxesById.size > 0 && (
        <details className={styles.boxList}>
          <summary>Короба</summary>
          <ul>
            {[...boxesById.values()].map((box) => (
              <li key={box.id}>{box.code}</li>
            ))}
          </ul>
        </details>
      )}
      {!shipped && (
        <>
          {shipment.wb && !ready && (
            <form
              className={styles.assign}
              onSubmit={(event) => {
                event.preventDefault();
                if (pending) return;
                const id = new FormData(event.currentTarget).get("employeeId");
                if (typeof id === "string" && id)
                  void onAssign(id).catch(() => {});
              }}
            >
              <label className="field">
                Исполнитель отбора
                <Select
                  key={shipment.employeeId ?? "free"}
                  name="employeeId"
                  defaultValue={shipment.employeeId ?? ""}
                  disabled={pending}
                  required
                >
                  <option value="">Выберите сотрудника</option>
                  {data.employees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button type="submit" variant="secondary" disabled={pending}>
                Назначить
              </Button>
            </form>
          )}
          <ShipmentPallets
            readiness={state}
            data={data}
            pending={pending}
            onPrepare={onPrepare}
          />
          {ready ? (
            <div className={styles.dispatch}>
              <p className={styles.note}>
                Подтвердите отправку после передачи груза.
              </p>
              <Button
                disabled={pending}
                onClick={() => void onShip().catch(() => {})}
              >
                Подтвердить отправку
              </Button>
            </div>
          ) : legacy ? (
            <p className={styles.note}>
              Завершите отбор через QR рабочей зоны.
            </p>
          ) : (
            <div className={styles.actions}>
              <Link
                href={`/work?mode=shipping&shipmentId=${shipment.id}`}
                className="button button--secondary"
              >
                Открыть отбор
              </Link>
            </div>
          )}
        </>
      )}
      {shipped && (hasRemainder || hasEmptyPallet) && (
        <div className={styles.actions}>
          {hasRemainder && (
            <Link href="/movements" className={styles.textLink}>
              Вернуть остаток на хранение
            </Link>
          )}
          {hasEmptyPallet && (
            <Link href="/movements" className={styles.textLink}>
              Подтвердить вывоз пустого поддона
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
