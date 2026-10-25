"use client";
import Link from "next/link";
import { MapPin, PackageCheck, Pause, Play, Printer } from "lucide-react";
import { useSession } from "@/entities/session";
import { LocationMapButton } from "@/entities/warehouse-map";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, EmployeeScan, useEmployeeScanActivity } from "@/shared/ui";
import {
  employeeAssemblyScanContext,
  employeeAssemblyStep,
  selectEmployeeAssembly,
} from "../lib/employee-assembly";
import { useEmployeeAssembly } from "../model/use-employee-assembly";
import styles from "./employee-assembly.module.css";

export function EmployeeAssembly({
  data,
  onIdle,
  onProblem,
}: {
  data: WorkspaceDto;
  onIdle: () => void;
  onProblem?: (message: string) => void;
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
    contextKey: context,
    pending: operations.pending,
    disabled: !working || !own || !!configurationProblem,
    error: operations.error,
    onProblem,
  };
  return (
    <section className={styles.feature} aria-label="Моя сборка">
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
          <header className={styles.taskHeader}>
            <div>
              <span>Сборка</span>
            </div>
            {step !== "claim" && step !== "resume" && own && (
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
          {scanActivity.pending > 0 && operations.error && (
            <p className={styles.help}>
              Перед паузой дождитесь сохранения сканов или исправьте непринятый
              код.
            </p>
          )}
          <div className={styles.taskTitle}>
            <h2>{sku?.name ?? "Тематика недоступна"}</h2>
            <p>
              Короб{" "}
              <strong>
                {currentBox} из {task.boxesTarget}
              </strong>{" "}
              · по {task.unitsPerBox} раскрасок
            </p>
          </div>
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
                disabled={operations.pending || !!configurationProblem}
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
                  <span className={styles.stepLabel}>1 · ИСТОЧНИК</span>
                  <h3>
                    {task.scannedUnits > 0
                      ? "Сканируйте следующую паллету"
                      : "Сканируйте паллету"}
                  </h3>
                  <div className={styles.destination}>
                    <MapPin size={22} />
                    <div>
                      <span>Адрес</span>
                      <strong>{location?.code ?? "Не указан"}</strong>
                      {location?.name && <small>{location.name}</small>}
                    </div>
                  </div>
                  <LocationMapButton
                    data={data}
                    locationId={location?.id}
                    routeRequest={{ kind: "assembly", id: task.id }}
                    intent="take"
                    contextKey={`assembly:${user?.employeeId ?? ""}:${context}:${location?.id ?? "missing"}`}
                  />
                  <div className={styles.codeCard}>
                    <span>QR / код паллеты</span>
                    <strong>{pallet?.code ?? "Источник недоступен"}</strong>
                  </div>
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
                  <span className={styles.stepLabel}>
                    2 · ПОДГОТОВКА И КОРОБ
                  </span>
                  <h3>
                    {task.unitsPerBox === 20
                      ? "Подготовьте 2 упаковки по 10"
                      : `Подготовьте ${task.unitsPerBox} раскрасок`}
                  </h3>
                  <p>
                    Промаркируйте раскраски. Возьмите готовую этикетку, наклейте
                    на короб и отсканируйте QR.
                  </p>
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
                  <span className={styles.stepLabel}>
                    3 · РАСКРАСКИ В КОРОБЕ
                  </span>
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
          {step === "resume" && (
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
