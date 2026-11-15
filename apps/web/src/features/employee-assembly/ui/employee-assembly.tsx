"use client";
import Link from "next/link";
import { PackageCheck, Pause, Play, Printer } from "lucide-react";
import { useSession } from "@/entities/session";
import { LocationMapButton } from "@/entities/warehouse-map";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { consumableNames, packagingForNextBox } from "@/shared/lib/consumables";
import { Button, EmployeeScan, useEmployeeScanActivity } from "@/shared/ui";
import {
  employeeAssemblyScanContext,
  employeeAssemblyStep,
  selectEmployeeAssembly,
} from "../lib/employee-assembly";
import { useEmployeeAssembly } from "../model/use-employee-assembly";
import { assemblyWaitsForSpace } from "../lib/assembly-capacity";
import styles from "./employee-assembly.module.css";

export function EmployeeAssembly({
  data,
  onIdle,
  onProblem,
  locked = false,
}: {
  data: WorkspaceDto;
  onIdle: () => void;
  onProblem?: (message: string) => void;
  locked?: boolean;
}) {
  const { user } = useSession();
  const scanActivity = useEmployeeScanActivity();
  const operations = useEmployeeAssembly();
  const employee = data.employees.find(
    (employee) => employee.id === user?.employeeId,
  );
  const working = employee?.status === "working";
  const task = selectEmployeeAssembly(data.tasks, user?.employeeId ?? "");
  const sku = data.skus.find((sku) => sku.id === task?.skuId);
  const step = task ? employeeAssemblyStep(task) : null;
  const reservation = task?.reservations.find(
    (reservation) => reservation.quantity > 0,
  );
  const pallet = data.pallets.find(
    (pallet) => pallet.id === reservation?.palletId,
  );
  const location = data.locations.find(
    (location) => location.id === pallet?.locationId,
  );
  const own = !!task && task.employeeId === user?.employeeId;
  const capacityBlocked = assemblyWaitsForSpace(data.assemblyPressure, task);
  const assemblyAvailable = data.locations.some(
    (location) =>
      !location.archived && !location.blocked && location.kind === "assembly",
  );
  const sourceProblem =
    step === "source"
      ? !reservation || !pallet
        ? "Источник для сборки не найден. Сообщите руководителю, чтобы проверить резерв."
        : pallet.status !== "stored"
          ? "Паллета-источник сейчас недоступна для сборки. Дождитесь её размещения или сообщите руководителю."
          : !location || location.archived
            ? "У паллеты-источника нет доступного адреса. Сообщите руководителю."
            : null
      : null;
  const configurationProblem =
    !sku && task
      ? "Тематика задания недоступна. Сообщите руководителю."
      : own && step !== "resume" && !assemblyAvailable
        ? "Нет доступной зоны сборки для готового короба. Сообщите руководителю."
        : sourceProblem;
  const problem = configurationProblem ?? operations.error;
  const context = task ? employeeAssemblyScanContext(task) : "empty";
  const currentBox = task
    ? Math.min(task.boxesCompleted + 1, task.boxesTarget)
    : 0;
  const percent =
    task && task.unitsPerBox > 0
      ? Math.max(0, Math.min(100, (task.scannedUnits / task.unitsPerBox) * 100))
      : 0;
  const scanProps = {
    compact: true,
    contextKey: context,
    pending: operations.pending,
    disabled: !working || !own || !!configurationProblem || capacityBlocked,
    error: operations.error,
    onProblem,
  };
  return (
    <section className={styles.feature} aria-label="Моя сборка">
      {data.assemblyPressure &&
        ["near_full", "full"].includes(data.assemblyPressure.level) && (
          <div className={`glass-panel ${styles.action}`} role="status">
            <strong>
              {data.assemblyPressure.boxes > 0
                ? "Освободите место на сборочной паллете"
                : "Дождитесь свободного места"}
            </strong>
            <p>{data.assemblyPressure.message}</p>
            <p>
              {task && (task.boxCodeConfirmed || task.scannedUnits > 0)
                ? "Закончите текущий короб, затем сканируйте QR зоны размещения."
                : data.assemblyPressure.boxes > 0
                  ? "Сканируйте QR зоны размещения, затем любой готовый короб."
                  : "Дождитесь свободного места или сканируйте QR другой рабочей зоны."}
            </p>
          </div>
        )}
      {operations.notice && (
        <p className={styles.success} role="status">
          {operations.notice}
        </p>
      )}
      {!working ? (
        <div className={`glass-panel ${styles.center}`}>
          <Pause size={26} />
          <h2>
            {employee?.status === "break"
              ? "Смена на перерыве"
              : "Начните смену"}
          </h2>
          <p>
            {task
              ? "Задание и текущий короб сохранены. Возобновите рабочую смену, чтобы продолжить."
              : "Чтобы взять задание и сканировать товар, начните рабочую смену."}
          </p>
          <Button onClick={onIdle}>К рабочему дню</Button>
        </div>
      ) : !task ? (
        <div className={`glass-panel ${styles.center}`}>
          <PackageCheck size={32} />
          <h2>Заданий на сборку нет</h2>
          <p>Можно разместить готовые короба на хранение.</p>
          <Button onClick={onIdle}>Разместить короба</Button>
        </div>
      ) : (
        <>
          {!locked && (
            <header className={styles.taskHeader}>
              <div>
                <span>Сборка</span>
              </div>
              {!locked && step !== "claim" && step !== "resume" && own && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={operations.pending || scanActivity.pending > 0}
                  onClick={() => void operations.pause(task)}
                  aria-label="Поставить мою сборку на паузу"
                >
                  <Pause size={16} />
                  Пауза
                </Button>
              )}
            </header>
          )}
          {!locked && scanActivity.pending > 0 && operations.error && (
            <p className={styles.help}>
              Перед паузой дождитесь сохранения сканов или исправьте непринятый
              код.
            </p>
          )}
          <p className={styles.taskContext}>
            {sku?.name ?? "Тематика недоступна"} · {task.unitsPerBox} шт. в
            коробе
            {task.boxesTarget > 1 &&
              ` · короб ${currentBox} из ${task.boxesTarget}`}
          </p>
          {step === "claim" || step === "resume" ? (
            <div className={`glass-panel ${styles.action}`}>
              <span className={styles.stepLabel}>
                {step === "resume"
                  ? "МОЁ ЗАДАНИЕ · НА ПАУЗЕ"
                  : task.employeeId
                    ? "НАЗНАЧЕНО МНЕ"
                    : "СВОБОДНОЕ ЗАДАНИЕ"}
              </span>
              <h3>
                {step === "resume"
                  ? "Продолжить сборку"
                  : "Взять задание в работу"}
              </h3>
              {step === "resume" && (
                <p>
                  В коробе сохранено {task.scannedUnits} из {task.unitsPerBox}{" "}
                  раскрасок.
                </p>
              )}
              {operations.error && (
                <p className={styles.error} role="alert">
                  {operations.error}
                </p>
              )}
              <Button
                className={styles.mainButton}
                disabled={
                  operations.pending ||
                  !!configurationProblem ||
                  capacityBlocked
                }
                aria-busy={operations.pending}
                onClick={() => void operations.claim(task)}
              >
                <Play size={18} />
                {step === "resume" ? "Продолжить задание" : "Взять задание"}
              </Button>
              {configurationProblem && (
                <p className={styles.error} role="alert">
                  {configurationProblem}
                </p>
              )}
            </div>
          ) : (
            <div className={`glass-panel ${styles.action}`}>
              {step === "source" && (
                <>
                  <span className={styles.stepLabel}>Шаг 1 из 3</span>
                  <h3>
                    {task.scannedUnits > 0
                      ? "Сканируйте следующую паллету"
                      : "Сканируйте паллету"}
                  </h3>
                  <p className={styles.sourceAddress}>
                    {location?.code ?? "Адрес не указан"}
                  </p>
                  <p>{pallet?.code ?? "Паллета недоступна"}</p>
                  <LocationMapButton
                    data={data}
                    locationId={location?.id}
                    routeRequest={{ kind: "assembly", id: task.id }}
                    intent="take"
                    contextKey={`assembly:${user?.employeeId ?? ""}:${context}:${location?.id ?? "missing"}`}
                  />
                  {task.scannedUnits > 0 && (
                    <p>
                      Предыдущая партия закончилась. В коробе остаётся{" "}
                      {task.scannedUnits} из {task.unitsPerBox}; подтвердите
                      следующий источник.
                    </p>
                  )}
                  {sourceProblem && (
                    <p className={styles.error} role="alert">
                      {sourceProblem}
                    </p>
                  )}
                  <EmployeeScan
                    {...scanProps}
                    label="Сканируйте QR паллеты"
                    repeat={false}
                    onScan={(value) => operations.scan(task, "source", value)}
                  />
                </>
              )}
              {step === "box" && (
                <>
                  <span className={styles.stepLabel}>Шаг 2 из 3</span>
                  <h3>Сканируйте QR короба</h3>
                  <p>
                    {task.unitsPerBox === 20
                      ? "Подготовьте 2 упаковки по 10."
                      : `Подготовьте ${task.unitsPerBox} раскрасок.`}{" "}
                    Промаркируйте раскраски и наклейте QR на короб.
                  </p>
                  {packagingForNextBox(task.consumableReservations ?? []).map(
                    (row) => (
                      <p key={`${row.locationId}/${row.item}`}>
                        {consumableNames[row.item]} · {row.quantity} шт. ·{" "}
                        <strong>
                          {
                            data.locations.find(
                              (address) => address.id === row.locationId,
                            )?.code
                          }
                        </strong>
                      </p>
                    ),
                  )}
                  <details className={styles.help}>
                    <summary>Нет готовой этикетки</summary>
                    <Link
                      className={`button button--secondary ${styles.print}`}
                      href={`/labels/box/${encodeURIComponent(task.openBoxCode)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Printer size={18} />
                      Напечатать отдельную этикетку
                    </Link>
                  </details>
                  <EmployeeScan
                    {...scanProps}
                    label="Сканируйте этикетку короба"
                    repeat={false}
                    onScan={(value) => operations.scan(task, "box", value)}
                  />
                </>
              )}
              {step === "items" && (
                <>
                  <span className={styles.stepLabel}>Шаг 3 из 3</span>
                  <h3>Сканируйте каждую раскраску</h3>
                  <div
                    className={styles.counter}
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <strong>{task.scannedUnits}</strong>
                    <span>/ {task.unitsPerBox}</span>
                  </div>
                  <div
                    className={styles.progress}
                    role="progressbar"
                    aria-label="Раскраски в текущем коробе"
                    aria-valuenow={task.scannedUnits}
                    aria-valuemin={0}
                    aria-valuemax={task.unitsPerBox}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <EmployeeScan
                    {...scanProps}
                    label="Сканируйте каждую раскраску"
                    repeat={true}
                    onScan={(value) => operations.scan(task, "barcode", value)}
                  />
                  <p className={styles.help}>
                    Готовый короб поставьте на общую паллету сборки.
                  </p>
                </>
              )}
              {step === "recovery" && (
                <>
                  <span className={styles.stepLabel}>
                    ВОССТАНОВЛЕНИЕ КОРОБА
                  </span>
                  <h3>Раскраски уже учтены</h3>
                  <p>
                    В коробе {task.scannedUnits} из {task.unitsPerBox}.
                    Подтвердите код {task.openBoxCode}, чтобы завершить
                    сохранённый полный короб.
                  </p>
                  <EmployeeScan
                    {...scanProps}
                    label="Сканируйте код полного короба"
                    repeat={false}
                    onScan={(value) => operations.recover(task, value)}
                  />
                </>
              )}
              {configurationProblem &&
                configurationProblem !== sourceProblem && (
                  <p className={styles.error} role="alert">
                    {configurationProblem}
                  </p>
                )}
            </div>
          )}
          {problem && onProblem && (
            <Button
              variant="ghost"
              disabled={operations.pending}
              onClick={() =>
                onProblem(`${task.code}: ${problem}. Позовите руководителя.`)
              }
            >
              Нужна помощь
            </Button>
          )}
          {!locked && step === "resume" && (
            <Button
              variant="ghost"
              disabled={operations.pending}
              onClick={onIdle}
            >
              Разместить короба
            </Button>
          )}
        </>
      )}
    </section>
  );
}
