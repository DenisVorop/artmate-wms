"use client";
import { MapPin, PackageCheck, Truck } from "lucide-react";
import { useSession } from "@/entities/session";
import { LocationMapButton } from "@/entities/warehouse-map";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import {
  Button,
  EmployeeScan,
  useEmployeeScanActivity,
  useEmployeeScanGateway,
} from "@/shared/ui";
import {
  employeeShippingProgress,
  employeeShippingWork,
  employeeShippingScopeIssue,
} from "../lib/shipping-work";
import { useEmployeeShipping } from "../model/use-employee-shipping";
import styles from "./employee-shipping.module.css";

const boxCount = (count: number) =>
  `${count} ${count % 100 >= 11 && count % 100 <= 14 ? "коробов" : count % 10 === 1 ? "короб" : count % 10 >= 2 && count % 10 <= 4 ? "короба" : "коробов"}`;

export function EmployeeShipping({
  data,
  onIdle,
  onProblem,
}: {
  data: WorkspaceDto;
  onIdle: () => void;
  onProblem?: (message: string) => void;
}) {
  const { user } = useSession();
  const commands = useEmployeeShipping();
  const scans = useEmployeeScanActivity();
  const gateway = useEmployeeScanGateway();
  const { assignment, zone, shipment } = employeeShippingWork(
    data,
    user?.employeeId ?? "",
  );
  const working =
    data.employees.find((employee) => employee.id === user?.employeeId)
      ?.status === "working";
  const progress = shipment ? employeeShippingProgress(shipment) : null;
  const boxes =
    shipment?.boxIds.map((id) => data.boxes.find((box) => box.id === id)) ?? [];
  const nextBox = data.boxes.find((box) => box.id === progress?.nextBoxId);
  const nextAddress = data.locations.find(
    (location) => location.id === nextBox?.locationId,
  );
  const busy = commands.pending || gateway.pending || scans.pending > 0;
  const issue = !working
    ? "Начните или возобновите рабочую смену."
    : !zone || zone.archived || zone.kind !== "shipping"
      ? "Зона отгрузки недоступна. Отсканируйте действующую зону."
      : assignment?.jobId && !shipment
        ? "Назначенная отгрузка недоступна. Обновите данные или сообщите руководителю."
        : shipment && shipment.status !== "draft"
          ? "Эта отгрузка уже завершена. Ожидайте следующего задания из зоны."
          : shipment
            ? employeeShippingScopeIssue(data, shipment, zone)
            : null;
  const ready = !!shipment && !!zone && !!progress?.complete && !issue;
  const totalUnits = boxes.reduce((sum, box) => sum + (box?.units ?? 0), 0);
  return (
    <section className={styles.feature} aria-label="Моя отгрузка">
      {commands.notice && (
        <p className={styles.success} role="status">
          {commands.notice}
        </p>
      )}
      <header className={styles.header}>
        <span>Отгрузка</span>
        {zone && <small>{zone.name}</small>}
      </header>
      {!shipment ? (
        <div className={`glass-panel ${styles.center}`}>
          <Truck size={30} />
          <h2>{issue ? "Работа недоступна" : "Готовых отгрузок нет"}</h2>
          <p>
            {issue ??
              assignment?.message ??
              "Для этой зоны пока нет подготовленных коробов. Руководитель создаёт отгрузки и готовит паллеты."}
          </p>
          <Button disabled={busy} onClick={onIdle}>
            К выбору зоны
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.heading}>
            <h2>
              {data.skus.find((sku) => sku.id === shipment.skuId)?.name ??
                "Готовые короба"}
            </h2>
            <p>
              {shipment.code} · {boxCount(shipment.boxesRequested)}
            </p>
          </div>
          <div className={`glass-panel ${styles.panel}`}>
            {progress && !progress.complete ? (
              <>
                <span className={styles.eyebrow}>ПРОВЕРКА КОРОБОВ</span>
                <div
                  className={styles.counter}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <strong>{progress.scanned}</strong>
                  <span>/ {progress.total}</span>
                </div>
                <p className={styles.counterLabel}>коробов подтверждено</p>
                {nextBox && (
                  <>
                    <div className={styles.address}>
                      <MapPin size={21} />
                      <div>
                        <span>Возьмите короб с адреса</span>
                        <strong>
                          {nextAddress?.code ?? "Адрес недоступен"}
                        </strong>
                      </div>
                    </div>
                    <LocationMapButton
                      data={data}
                      locationId={nextAddress?.id}
                      intent="take"
                      contextKey={`shipping:${user?.employeeId ?? ""}:${shipment.id}:${nextBox.id}:${nextAddress?.id ?? "missing"}`}
                    />
                    <div className={styles.box}>
                      <span>Следующий короб</span>
                      <strong>{nextBox.code}</strong>
                      <small>{nextBox.units} раскрасок</small>
                    </div>
                  </>
                )}
                {issue && (
                  <p className={styles.error} role="alert">
                    {issue}
                  </p>
                )}
                <EmployeeScan
                  contextKey={`shipping:${shipment.id}:${progress.nextBoxId ?? "missing"}`}
                  label="Сканируйте код короба"
                  pending={commands.pending}
                  disabled={!!issue || !nextBox}
                  error={commands.error}
                  repeat={false}
                  onScan={(value) => commands.scan(shipment, value)}
                  onProblem={onProblem}
                />
                <p className={styles.help}>
                  Скан подтверждает наличие короба. Остатки изменятся после
                  отдельного подтверждения отгрузки.
                </p>
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
          {progress?.scanned === 0 && (
            <Button variant="ghost" disabled={busy} onClick={onIdle}>
              К выбору зоны
            </Button>
          )}
        </>
      )}
    </section>
  );
}
