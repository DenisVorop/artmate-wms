"use client";
import { useState } from "react";
import { useSession } from "@/entities/session";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Truck, CheckCircle2, Package } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import {
  Button,
  Badge,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/shared/ui";
import { shipmentSchema, type ShipmentValues } from "../lib/shipment-form";
import { useShipmentState } from "../lib/use-shipment-state";
import { useShipments } from "../model/use-shipments";
import { isShipmentBoxAvailable } from "../lib/shipment-readiness";
import { ShipmentCard } from "./shipment-card";
import { ShipmentPreparationForm } from "./shipment-preparation-form";
import styles from "./shipments.module.css";

function ManagerShipmentsFeature() {
  const { data, isPending, isError, refetch } = useWorkspace();
  const commands = useShipments();
  const ui = useShipmentState();
  const [wbNumber, setWbNumber] = useState("");
  const [wbReservations, setWbReservations] = useState<string[]>([]);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ShipmentValues>({
    resolver: zodResolver(shipmentSchema),
    defaultValues: { skuId: "", boxesRequested: 1 },
  });
  const selectedSku = watch("skuId");
  if (isPending) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  const reservedDrafts = data.shipments.filter(
    (row) =>
      row.status === "draft" &&
      !row.wb &&
      !row.employeeId &&
      !row.scannedBoxIds?.length,
  );
  const available = data.boxes.filter(
    (box) => box.skuId === selectedSku && isShipmentBoxAvailable(data, box),
  ).length;
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">КОМПЛЕКТАЦИЯ И ОТПРАВКА</p>
          <h1 className="page-heading">Отгрузки</h1>
          <p className="page-description">
            Зарезервируйте короба по FIFO, отберите их по QR и подтвердите
            отправку.
          </p>
        </div>
        <Badge tone="success">
          <Truck size={14} />
          Отбор по FIFO
        </Badge>
      </div>
      {ui.notice && (
        <div role="status" className={`ops-success ${styles.shipNotice}`}>
          <CheckCircle2 size={14} />
          {ui.notice}
        </div>
      )}
      {commands.error && !ui.preparingId && (
        <div role="alert" className="ops-error">
          {commands.error}
        </div>
      )}
      <div className="ops-layout">
        <section className="glass-panel ops-panel">
          <h2>Отгрузки склада</h2>
          {data.shipments.length === 0 ? (
            <EmptyState
              title="Отгрузок пока нет"
              description="Выберите тематику и количество коробов в форме новой отгрузки."
            />
          ) : (
            <div className="ops-list">
              {[...data.shipments].reverse().map((shipment) => (
                <ShipmentCard
                  key={shipment.id}
                  shipment={shipment}
                  data={data}
                  pending={commands.pending}
                  onPrepare={(palletId) => {
                    commands.clearError();
                    ui.setPreparingId(palletId);
                  }}
                  onAssign={async (employeeId) => {
                    await commands.assignWb(shipment.id, employeeId);
                    ui.setNotice("Исполнитель отбора обновлён.");
                  }}
                  onShip={async () => {
                    await commands.ship(shipment.id);
                    ui.setNotice(
                      `${shipment.code}: отправлено ${shipment.boxesRequested} коробов. Остаток сохранён.`,
                    );
                  }}
                />
              ))}
            </div>
          )}
        </section>
        <aside className="ops-stack">
          <section className="glass-panel ops-panel">
            <h2>Поставка Wildberries</h2>
            <form
              className="ops-form"
              onSubmit={(event) => {
                event.preventDefault();
                void commands
                  .importWb(wbNumber.trim(), wbReservations)
                  .then(() => {
                    setWbNumber("");
                    setWbReservations([]);
                    ui.setNotice(
                      "Поставка WB загружена. Сотрудник может взять отбор.",
                    );
                  })
                  .catch(() => {});
              }}
            >
              <label>
                Номер поставки WB
                <input
                  value={wbNumber}
                  onChange={(event) => setWbNumber(event.target.value)}
                  inputMode="numeric"
                  pattern="[1-9][0-9]{0,19}"
                  required
                />
              </label>
              {reservedDrafts.length > 0 && (
                <fieldset className={styles.reserveList}>
                  <legend>Использовать уже зарезервированные короба</legend>
                  {reservedDrafts.map((row) => (
                    <label key={row.id}>
                      <input
                        type="checkbox"
                        checked={wbReservations.includes(row.id)}
                        onChange={(event) =>
                          setWbReservations((ids) =>
                            event.target.checked
                              ? [...ids, row.id]
                              : ids.filter((id) => id !== row.id),
                          )
                        }
                      />
                      <span>
                        {data.skus.find((sku) => sku.id === row.skuId)?.name ??
                          row.code}{" "}
                        · {row.boxesRequested} кор. · {row.code}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <Button type="submit" disabled={commands.pending}>
                Загрузить и создать отбор
              </Button>
            </form>
          </section>
          <section className="glass-panel ops-panel">
            <h2>Новая отгрузка</h2>
            <form
              className="ops-form"
              onSubmit={handleSubmit(async (values) => {
                try {
                  await commands.create(values);
                  ui.setNotice(
                    "Отгрузка создана. Короба зарезервированы по FIFO и доступны к отбору.",
                  );
                } catch {
                  /* The API error is rendered above the list. */
                }
              })}
            >
              <label>
                Тематика
                <select {...register("skuId")}>
                  <option value="">Выберите тематику</option>
                  {data.skus.map((sku) => (
                    <option key={sku.id} value={sku.id}>
                      {sku.name}
                    </option>
                  ))}
                </select>
                {errors.skuId && (
                  <span className="ops-field-error">
                    {errors.skuId.message}
                  </span>
                )}
              </label>
              <label>
                Количество коробов
                <input
                  type="number"
                  min={1}
                  {...register("boxesRequested", { valueAsNumber: true })}
                />
                {errors.boxesRequested && (
                  <span className="ops-field-error">
                    Укажите целое положительное число
                  </span>
                )}
              </label>
              {selectedSku && (
                <div className="ops-source">
                  <span className="ops-description">Доступно к отгрузке</span>
                  <strong>{available} кор.</strong>
                </div>
              )}
              <Button type="submit" disabled={commands.pending}>
                Создать отгрузку
                <Package size={16} />
              </Button>
            </form>
          </section>
          <div className="ops-note">
            В отгрузку попадут только зарезервированные короба. Отбор доступен
            на рабочем экране сотрудника.
          </div>
        </aside>
      </div>
      <ShipmentPreparationForm
        palletId={ui.preparingId}
        data={data}
        pending={commands.pending}
        error={commands.error}
        onClose={() => ui.setPreparingId(null)}
        onCreate={async (values) => {
          await commands.prepare(values);
          ui.setNotice(
            "Задание на спуск создано. Подтвердите забор и размещение в разделе «Перемещения».",
          );
        }}
      />
    </>
  );
}

export function ShipmentsFeature() {
  const { isManager } = useSession();
  return isManager ? (
    <ManagerShipmentsFeature />
  ) : (
    <EmptyState
      title="Отгрузки доступны менеджеру"
      description="Для работы с заданиями откройте сборку или размещение коробов."
    />
  );
}
