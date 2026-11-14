"use client";
import { useRef, useState } from "react";
import { History, MapPin, PackageCheck, Truck } from "lucide-react";
import { useSession } from "@/entities/session";
import { LocationMapButton } from "@/entities/warehouse-map";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import {
  Button,
  EmployeeScan,
  Modal,
  useEmployeeScanActivity,
  useEmployeeScanGateway,
} from "@/shared/ui";
import {
  employeeShippingProgress,
  employeeShippingWork,
  employeeShippingScopeIssue,
  employeeWbPickHistory,
} from "../lib/shipping-work";
import { useEmployeeShipping } from "../model/use-employee-shipping";
import styles from "./employee-shipping.module.css";

const boxCount = (count: number) =>
  `${count} ${count % 100 >= 11 && count % 100 <= 14 ? "коробов" : count % 10 === 1 ? "короб" : count % 10 >= 2 && count % 10 <= 4 ? "короба" : "коробов"}`;

export function EmployeeShipping({
  data,
  onIdle,
  onQueue,
  onProblem,
  shipmentId,
}: {
  data: WorkspaceDto;
  onIdle: () => void;
  onQueue: () => void;
  onProblem?: (message: string) => void;
  shipmentId?: string;
}) {
  const { user } = useSession();
  const commands = useEmployeeShipping();
  const scans = useEmployeeScanActivity();
  const gateway = useEmployeeScanGateway();
  const [dismissedId, setDismissedId] = useState<string>();
  const [historyShipmentId, setHistoryShipmentId] = useState<string>();
  const section = useRef<HTMLElement>(null);
  const {
    assignment,
    zone,
    shipment: currentShipment,
  } = employeeShippingWork(data, user?.employeeId ?? "");
  const shipment =
    currentShipment?.id === dismissedId ? undefined : currentShipment;
  const working =
    data.employees.find((employee) => employee.id === user?.employeeId)
      ?.status === "working";
  const queue = data.shipments.filter(
    (row) =>
      row.status === "draft" &&
      !row.employeeId &&
      !employeeShippingProgress(row).complete,
  );
  const selected = shipmentId
    ? queue.find((row) => row.id === shipmentId)
    : null;
  const direct = shipment?.pickingMode === "box";
  const progress = shipment ? employeeShippingProgress(shipment) : null;
  const boxes =
    shipment?.boxIds.map((id) => data.boxes.find((box) => box.id === id)) ?? [];
  const nextBox = data.boxes.find((box) => box.id === progress?.nextBoxId);
  const nextAddress = data.locations.find(
    (location) => location.id === nextBox?.locationId,
  );
  const wb = shipment?.wb;
  const history = shipment && wb ? employeeWbPickHistory(shipment) : [];
  const openHistory = historyShipmentId === shipment?.id && history.length > 0;
  const step = wb?.pendingBoxId
    ? "label"
    : wb && wb.locationId !== nextAddress?.id
      ? "location"
      : "box";
  const scanLabel =
    step === "label"
      ? "Сканируйте этикетку WB"
      : step === "location"
        ? "Сканируйте QR места"
        : "Сканируйте код короба";
  const nextSku = data.skus.find((sku) => sku.id === nextBox?.skuId)?.name;
  const busy = commands.pending || gateway.pending || scans.pending > 0;
  const issue = !working
    ? "Начните или возобновите рабочую смену."
    : shipment &&
        !direct &&
        (!zone || zone.archived || zone.kind !== "shipping")
      ? "Зона отгрузки недоступна. Отсканируйте действующую зону."
      : assignment?.jobId && !shipment
        ? "Назначенная отгрузка недоступна. Обновите данные или сообщите руководителю."
        : shipment && shipment.status !== "draft"
          ? "Эта отгрузка уже завершена. Ожидайте следующего задания из зоны."
          : shipment
            ? employeeShippingScopeIssue(data, shipment, zone)
            : null;
  const ready = !!shipment && !!zone && !!progress?.complete && !issue;
  const nextPallet = data.pallets.find(
    (pallet) => pallet.id === nextBox?.palletId,
  );
  const unavailable =
    direct &&
    nextBox &&
    (!nextAddress ||
      nextAddress.archived ||
      nextAddress.blocked ||
      nextPallet?.status !== "stored" ||
      data.movements.some(
        (m) =>
          m.palletId === nextPallet.id &&
          ["planned", "in_transit"].includes(m.status),
      ));
  const totalUnits = boxes.reduce((sum, box) => sum + (box?.units ?? 0), 0);
  return (
    <section ref={section} className={styles.feature} aria-label="Моя отгрузка">
      {commands.notice && (
        <p className={styles.success} role="status">
          {commands.notice}
        </p>
      )}
      {!shipment && !issue && queue.length > 0 ? (
        <div className={`glass-panel ${styles.panel}`}>
          <h2 className={styles.queueTitle}>Отбор коробов</h2>
          {commands.error && (
            <p className={styles.error} role="alert">
              {commands.error}
            </p>
          )}
          <ul className={styles.queue}>
            {(selected
              ? [selected, ...queue.filter((row) => row.id !== selected.id)]
              : queue
            ).map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {row.wb
                      ? `Поставка WB № ${row.wb.supplyId}`
                      : (data.skus.find((sku) => sku.id === row.skuId)?.name ??
                        row.code)}
                  </strong>
                  <small>
                    {boxCount(
                      row.boxIds.length - (row.scannedBoxIds?.length ?? 0),
                    )}{" "}
                    к отбору · {row.code}
                  </small>
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void commands.claim(row.id)}
                >
                  Взять отбор
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" disabled={busy} onClick={onIdle}>
            К рабочим зонам
          </Button>
        </div>
      ) : !shipment ? (
        <div className={`glass-panel ${styles.center}`}>
          <Truck size={30} />
          <h2>{issue ? "Работа недоступна" : "Готовых отгрузок нет"}</h2>
          <p>
            {issue ??
              assignment?.message ??
              "Руководитель создаёт отгрузки в WMS. Новые задания появятся здесь."}
          </p>
          <Button disabled={busy} onClick={onIdle}>
            К выбору зоны
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.heading}>
            <h2>
              {wb
                ? `Поставка WB № ${wb.supplyId}`
                : (data.skus.find((sku) => sku.id === shipment.skuId)?.name ??
                  "Готовые короба")}
            </h2>
            <p>
              {shipment.code} · {boxCount(shipment.boxesRequested)}
            </p>
          </div>
          <div className={`glass-panel ${styles.panel}`}>
            {history.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  className={styles.historyButton}
                  aria-haspopup="dialog"
                  onClick={() => setHistoryShipmentId(shipment.id)}
                >
                  <History size={18} aria-hidden="true" />
                  Что уже отобрано
                </Button>
                <Modal
                  open={openHistory}
                  title="Отобранные короба"
                  description="Номера на этикетках WB. Последний скан сверху."
                  onClose={() => setHistoryShipmentId(undefined)}
                  onClosed={() => {
                    section.current
                      ?.querySelector<HTMLInputElement>(
                        "input[data-employee-scan-input]:not(:disabled)",
                      )
                      ?.focus({ preventScroll: true });
                  }}
                >
                  <ol className={`${styles.review} ${styles.historyList}`}>
                    {history.map(({ boxId, skuId, number }) => (
                      <li key={boxId}>
                        <span>
                          {data.skus.find((sku) => sku.id === skuId)?.name ??
                            "Короб"}
                        </span>
                        <strong>{number}</strong>
                      </li>
                    ))}
                  </ol>
                </Modal>
              </>
            )}
            {progress && !progress.complete ? (
              <>
                {direct && (
                  <h3>{wb ? scanLabel : "Возьмите и отсканируйте короб"}</h3>
                )}
                <p className={styles.progress} role="status">
                  {progress.scanned} из {progress.total}{" "}
                  {direct ? "отобрано" : "подтверждено"}
                </p>
                {nextBox && (
                  <>
                    <div className={styles.box}>
                      <span>{nextSku ?? "Следующий короб"}</span>
                      <strong>{nextBox.code}</strong>
                      {step === "label" && (
                        <small>
                          {nextBox.units} шт. в коробе. После сигнала наклейте
                          этикетку.
                        </small>
                      )}
                    </div>
                    <div className={styles.address}>
                      <MapPin size={21} />
                      <div>
                        <span>Адрес</span>
                        <strong>
                          {nextAddress?.code ?? "Адрес недоступен"}
                        </strong>
                      </div>
                    </div>
                    <LocationMapButton
                      data={data}
                      locationId={nextAddress?.id}
                      routeRequest={
                        shipment.workZoneId
                          ? {
                              kind: "shipping",
                              id: shipment.id,
                              boxId: nextBox.id,
                            }
                          : undefined
                      }
                      intent="take"
                      contextKey={`shipping:${user?.employeeId ?? ""}:${shipment.id}:${nextBox.id}:${nextAddress?.id ?? "missing"}`}
                    />
                  </>
                )}
                {issue && (
                  <p className={styles.error} role="alert">
                    {issue}
                  </p>
                )}
                {unavailable && (
                  <p className={styles.error} role="status">
                    Следующий короб сейчас недоступен. Можно сканировать другие
                    короба из резерва.
                  </p>
                )}
                <EmployeeScan
                  contextKey={`shipping:${shipment.id}`}
                  label={scanLabel}
                  pending={commands.pending}
                  disabled={!!issue}
                  error={commands.error}
                  repeat={direct}
                  onScan={(value) => commands.scan(shipment, value)}
                  onProblem={onProblem}
                />
                {direct && !wb && (
                  <Button
                    variant="ghost"
                    disabled={busy || scans.unsaved}
                    onClick={onIdle}
                  >
                    Выйти из отбора
                  </Button>
                )}
              </>
            ) : direct ? (
              <>
                <PackageCheck size={28} className={styles.readyIcon} />
                <h3>Отбор завершён</h3>
                <p className={styles.summary}>
                  Отобрано {boxCount(shipment.boxesRequested)}. Отправку
                  подтверждает руководитель.
                </p>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (wb) setDismissedId(shipment.id);
                    onQueue();
                  }}
                >
                  К отгрузкам
                </Button>
              </>
            ) : (
              <>
                <span className={styles.eyebrow}>ВСЕ КОРОБА ПОДТВЕРЖДЕНЫ</span>
                <PackageCheck size={28} className={styles.readyIcon} />
                <h3>Проверьте отгрузку</h3>
                <p className={styles.summary}>
                  <strong>{boxCount(shipment.boxesRequested)}</strong> ·{" "}
                  {totalUnits} раскрасок
                  <br />
                  Зона: {zone?.name ?? "недоступна"}
                </p>
                <ul
                  className={styles.review}
                  aria-label="Точный состав отгрузки"
                >
                  {boxes.map((box, index) => (
                    <li key={shipment.boxIds[index]}>
                      <span>{box?.code ?? "Короб недоступен"}</span>
                      <small>{box?.units ?? "—"} шт.</small>
                    </li>
                  ))}
                </ul>
                <p className={styles.help}>
                  После подтверждения эти короба будут отгружены и списаны с
                  остатка склада. Остальные короба на паллетах сохранятся.
                </p>
                {issue && (
                  <p className={styles.error} role="alert">
                    {issue}
                  </p>
                )}
                {commands.error && (
                  <p className={styles.error} role="alert">
                    {commands.error}
                  </p>
                )}
                <Button
                  className={styles.finish}
                  disabled={busy || !ready}
                  aria-busy={commands.pending}
                  onClick={() => {
                    if (shipment && zone)
                      void commands.finish(shipment, zone.id);
                  }}
                >
                  Отгрузить {boxCount(shipment.boxesRequested)}
                </Button>
              </>
            )}
          </div>
          {issue && onProblem && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => onProblem(`${shipment.code}: ${issue}`)}
            >
              Сообщить о проблеме
            </Button>
          )}
          {!direct && progress?.scanned === 0 && (
            <Button variant="ghost" disabled={busy} onClick={onIdle}>
              К выбору зоны
            </Button>
          )}
        </>
      )}
    </section>
  );
}
