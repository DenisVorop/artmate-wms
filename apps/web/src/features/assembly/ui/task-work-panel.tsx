"use client";
import { useSession } from "@/entities/session";
import Link from "next/link";
import {
  Check,
  MapPin,
  PackageCheck,
  Pause,
  Play,
  Printer,
} from "lucide-react";
import type {
  EmployeeDto,
  ScanTaskDtoKind,
  TaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import {
  assemblyStep,
  claimBlocked,
  nextSource,
  preparationHint,
  taskStatusLabels,
} from "../lib/assembly-queue";
import type { AssignmentValues } from "../lib/assembly-form";
import { ScanControl } from "./scan-control";
import { TaskAssignment } from "./task-assignment";
import styles from "./assembly.module.css";
export function TaskWorkPanel({
  task,
  data,
  actor,
  pending,
  error,
  onClaim,
  onPause,
  onScan,
  onRecover,
  onAssign,
}: {
  task: TaskDto;
  data: WorkspaceDto;
  actor: EmployeeDto | undefined;
  pending: boolean;
  error: string | null;
  onClaim: () => Promise<void>;
  onPause: () => Promise<void>;
  onScan: (kind: ScanTaskDtoKind, value: string) => Promise<boolean>;
  onRecover: (value: string) => Promise<boolean>;
  onAssign: (values: AssignmentValues) => Promise<WorkspaceDto | undefined>;
}) {
  const { isManager } = useSession();
  const sku = data.skus.find((item) => item.id === task.skuId);
  const owner = data.employees.find(
    (employee) => employee.id === task.employeeId,
  );
  const owns = actor?.status === "working" && task.employeeId === actor.id;
  const step = assemblyStep(task);
  const next = nextSource(task);
  const pallet = data.pallets.find((item) => item.id === next?.palletId);
  const location = data.locations.find(
    (item) => item.id === pallet?.locationId,
  );
  const canClaimReason = claimBlocked(task, actor, data.tasks);
  const hasAssembly = data.locations.some(
    (item) => !item.archived && !item.blocked && item.kind === "assembly",
  );
  const mainStep = step === "source" ? 0 : step === "box" ? 1 : 2;
  return (
    <section
      className={`glass-panel ${styles.work}`}
      aria-label={`Рабочее задание ${task.code}`}
    >
      <div className={styles.workHeader}>
        <div>
          <Badge
            tone={
              task.status === "completed" || task.status === "active"
                ? "success"
                : task.status === "paused"
                  ? "warning"
                  : "neutral"
            }
          >
            {taskStatusLabels[task.status]}
          </Badge>
          <h2>{sku?.name ?? "Тематика недоступна"}</h2>
          <p>
            <span className={styles.code}>{task.code}</span> ·{" "}
            {task.boxesCompleted} из {task.boxesTarget} коробов
            <br />
            {owner?.name ?? "Свободная очередь"} · по {task.unitsPerBox} шт.
          </p>
        </div>
        {task.status === "active" && owns && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onPause()}
            disabled={pending}
          >
            <Pause size={14} />
            Пауза
          </Button>
        )}
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Короба в задании"
        aria-valuemin={0}
        aria-valuemax={task.boxesTarget}
        aria-valuenow={task.boxesCompleted}
      >
        <span
          style={{
            width: `${task.boxesTarget ? (task.boxesCompleted / task.boxesTarget) * 100 : 0}%`,
          }}
        />
      </div>
      {task.status === "completed" ? null : task.status !== "active" ? (
        <div className={styles.stepPanel} style={{ marginTop: 20 }}>
          {task.status === "paused" && task.scannedUnits > 0 && (
            <p className={styles.help}>
              В текущем коробе {task.scannedUnits} из {task.unitsPerBox} шт.
            </p>
          )}
          {canClaimReason ? (
            <p className={styles.help}>
              {canClaimReason}
              {actor?.status !== "working" && (
                <>
                  {" "}
                  <Link href="/team">К сменам</Link>
                </>
              )}
            </p>
          ) : (
            <Button
              disabled={pending}
              onClick={() => void onClaim()}
              aria-busy={pending}
            >
              <Play size={15} aria-hidden="true" />
              {task.status === "paused"
                ? "Продолжить задание"
                : "Взять задание"}
            </Button>
          )}
        </div>
      ) : !owns ? (
        <div className={styles.info} style={{ marginTop: 20 }}>
          Сканирование и пауза доступны только исполнителю.
        </div>
      ) : (
        <>
          <div className={styles.steps} aria-label="Этапы текущего короба">
            {["Источник", "Подготовка и короб", "Раскраски"].map(
              (label, index) => (
                <div
                  key={label}
                  className={styles.step}
                  aria-current={index === mainStep ? "step" : undefined}
                  data-done={index < mainStep}
                >
                  <span>
                    {index < mainStep ? <Check size={12} /> : index + 1}
                  </span>
                  {label}
                </div>
              ),
            )}
          </div>
          <div className={styles.stepPanel}>
            {step === "source" && (
              <>
                <h3>Подтвердите паллету по FIFO</h3>
                {pallet ? (
                  <div className={styles.source}>
                    <MapPin size={19} />
                    <div>
                      <strong>{pallet.code}</strong>
                      <p>
                        Адрес:{" "}
                        {location?.code ??
                          (pallet.status === "in_transit"
                            ? "паллета в пути"
                            : "не указан")}{" "}
                        · зарезервировано{" "}
                        {next?.quantity.toLocaleString("ru-RU")} шт.
                        <br />
                        {task.scannedUnits > 0
                          ? "Старая партия закончилась. Сканируйте следующий источник; состав текущего короба сохранится."
                          : "Каждый новый короб начинается с подтверждения источника."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className={styles.info}>
                    Ожидаемый источник недоступен. Обновите данные или поставьте
                    задание на паузу. Сервер проверяет актуальность резервов при
                    сканировании.
                  </p>
                )}
                <ScanControl
                  key={`${task.id}:${task.openBoxCode}:source:${next?.palletId ?? ""}`}
                  label="Код паллеты-источника"
                  placeholder="Отсканируйте QR паллеты"
                  action="Подтвердить источник"
                  pending={pending}
                  onScan={(value) => onScan("source", value)}
                />
              </>
            )}
            {step === "box" && (
              <>
                <h3>{preparationHint(task.unitsPerBox)}</h3>
                <p className={styles.help}>
                  Промаркируйте товар. Наклейте свободную этикетку на короб и
                  отсканируйте её.
                </p>
                <details className={styles.help}>
                  <summary>Нет готовой этикетки</summary>
                  <Link
                    className="button button--secondary button--sm"
                    href={`/labels/box/${encodeURIComponent(task.openBoxCode)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Printer size={15} />
                    Напечатать отдельную этикетку
                  </Link>
                </details>
                <ScanControl
                  key={`${task.id}:${task.openBoxCode}:box`}
                  label="Код короба"
                  placeholder="Отсканируйте QR короба"
                  action="Подтвердить короб"
                  pending={pending}
                  onScan={(value) => onScan("box", value)}
                />
              </>
            )}
            {step === "items" && (
              <>
                <div>
                  <div className={styles.counter}>
                    <strong>{task.scannedUnits}</strong>
                    <span>/ {task.unitsPerBox}</span>
                  </div>
                  <p className={styles.counterCaption}>
                    раскрасок в текущем коробе
                  </p>
                </div>
                <p className={styles.help}>
                  Короб <span className={styles.code}>{task.openBoxCode}</span>{" "}
                  закроется после последнего скана.
                </p>
                <ScanControl
                  key={`${task.id}:${task.openBoxCode}:barcode`}
                  label="Штрихкод раскраски"
                  placeholder="Отсканируйте штрихкод товара"
                  action="Принять скан раскраски"
                  pending={pending}
                  onScan={(value) => onScan("barcode", value)}
                />
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || !sku?.barcode}
                    onClick={() => {
                      if (sku?.barcode) void onScan("barcode", sku.barcode);
                    }}
                  >
                    Добавить 1 шт. без сканера
                  </Button>
                  <p className={styles.help}>
                    Ручной режим использует штрихкод этой тематики. Каждое
                    нажатие списывает одну реальную единицу в текущий короб.
                  </p>
                </div>
              </>
            )}
            {step === "recovery" && (
              <>
                <h3>
                  <PackageCheck size={18} /> Восстановить полный короб
                </h3>
                <p className={styles.help}>
                  В старом задании уже учтены все {task.unitsPerBox} раскрасок.
                  Чтобы завершить упаковку, повторно отсканируйте код текущего
                  короба. Дополнительного списания товара не будет.
                </p>
                <div className={styles.box}>
                  <div>
                    <span>Ожидаемый короб</span>
                    <code>{task.openBoxCode}</code>
                  </div>
                  <Link
                    className="button button--secondary button--sm"
                    href={`/labels/box/${encodeURIComponent(task.openBoxCode)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Printer size={15} />
                    Этикетка
                  </Link>
                </div>
                <ScanControl
                  key={`${task.id}:${task.openBoxCode}:recovery`}
                  label="Код полного короба"
                  placeholder="Отсканируйте QR короба"
                  action="Закрыть полный короб"
                  pending={pending}
                  onScan={onRecover}
                />
              </>
            )}
            {!hasAssembly && (
              <p className={styles.info}>
                На складе нет активного места сборки.{" "}
                <Link
                  href="/warehouse"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Подготовьте место сборки ↗
                </Link>{" "}
                до последнего скана, чтобы сервер мог разместить готовый короб.
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <div className="ops-error" role="alert" style={{ marginTop: 17 }}>
          {error}
        </div>
      )}
      {isManager && task.status !== "completed" && (
        <TaskAssignment
          key={task.id}
          task={task}
          employees={data.employees}
          pending={pending}
          onAssign={onAssign}
        />
      )}
    </section>
  );
}
