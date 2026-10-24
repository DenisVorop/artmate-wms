"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Package, X } from "lucide-react";
import type { MovementDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import {
  movementTime,
  movementPalletName,
  movementKinds,
  movementStatuses,
  type ScanValues,
} from "../lib/movement-form";
import { MovementConfirmForm } from "./movement-confirm-form";
import styles from "./movements.module.css";

type Props = {
  movement: MovementDto;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onTake: (values: ScanValues) => Promise<unknown>;
  onPlace: (values: ScanValues) => Promise<unknown>;
  onCancel: () => Promise<unknown>;
};
export function MovementDetail({
  movement,
  data,
  pending,
  error,
  onTake,
  onPlace,
  onCancel,
}: Props) {
  const pallet = data.pallets.find((item) => item.id === movement.palletId);
  const source = data.locations.find(
    (item) => item.id === movement.fromLocationId,
  );
  const target = data.locations.find(
    (item) => item.id === movement.toLocationId,
  );
  const held = data.locations.find(
    (item) => item.id === pallet?.returnLocationId,
  );
  const step =
    movement.status === "completed"
      ? 3
      : movement.status === "in_transit"
        ? 2
        : movement.status === "planned"
          ? 1
          : 0;
  return (
    <section className={`glass-panel ops-panel ${styles.detail}`}>
      <div className="ops-card-top">
        <h2>Выполнение задания</h2>
        <Badge
          tone={
            movement.status === "completed"
              ? "success"
              : movement.status === "in_transit"
                ? "warning"
                : "neutral"
          }
        >
          {movementStatuses[movement.status]}
        </Badge>
      </div>
      <div className={styles.steps} aria-label={`Этап ${step} из 3`}>
        {[1, 2, 3].map((value) => (
          <span
            key={value}
            className={`${styles.step} ${step >= value ? styles.stepDone : ""}`}
          />
        ))}
      </div>
      <div className={styles.meta}>
        <div>
          <span>Задание</span>
          <strong className={styles.code}>{movement.code}</strong>
        </div>
        <div>
          <span>Операция</span>
          <strong>{movementKinds[movement.kind]}</strong>
        </div>
        <div>
          <span>Паллета</span>
          <strong className={styles.code}>{pallet?.code}</strong>
        </div>
        <div>
          <span>Тематика</span>
          <strong>{movementPalletName(data, pallet)}</strong>
        </div>
        <div>
          <span>Исполнитель</span>
          <strong>
            {
              data.employees.find(
                (employee) => employee.id === movement.employeeId,
              )?.name
            }
          </strong>
        </div>
        <div>
          <span>Текущий остаток</span>
          <strong>
            {pallet?.quantity} {pallet?.kind === "raw" ? "шт." : "кор."}
          </strong>
        </div>
      </div>
      <div className={styles.route}>
        <code>{source?.code ?? "—"}</code>
        <ArrowRight size={16} />
        <code>{target?.code ?? "—"}</code>
      </div>
      <div className={styles.meta}>
        <div>
          <span>Создано</span>
          <strong>{movementTime(movement.createdAt)}</strong>
        </div>
        {movement.takenAt && (
          <div>
            <span>Забрано</span>
            <strong>{movementTime(movement.takenAt)}</strong>
          </div>
        )}
        {movement.completedAt && (
          <div>
            <span>Размещено</span>
            <strong>{movementTime(movement.completedAt)}</strong>
          </div>
        )}
      </div>
      {movement.keepSourceReserved &&
        movement.kind === "lower" &&
        movement.status !== "cancelled" && (
          <p className={styles.hint}>
            {movement.status === "planned" ? (
              "После забора исходный адрес будет удерживаться для возврата."
            ) : held ? (
              <>
                Для возврата удерживается <strong>{held.code}</strong>.
              </>
            ) : (
              "Исходный адрес больше не удерживается."
            )}
          </p>
        )}
      {movement.kind === "return" && (
        <p className={styles.hint}>
          Возвращается текущий остаток паллеты. Количество и партии коробов
          сохранятся.
        </p>
      )}
      {movement.status === "planned" && (
        <>
          <MovementConfirmForm
            key={`${movement.id}-take`}
            mode="take"
            palletCode={pallet?.code ?? ""}
            locationCode={source?.code ?? ""}
            pending={pending}
            onConfirm={onTake}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void onCancel().catch(() => {})}
          >
            <X size={14} />
            Отменить до забора
          </Button>
        </>
      )}
      {movement.status === "in_transit" && (
        <>
          <p className={styles.hint}>
            Паллета в пути. Исходный адрес уже снят, целевой адрес остаётся
            зарезервированным. Завершите размещение.
          </p>
          <MovementConfirmForm
            key={`${movement.id}-place`}
            mode="place"
            palletCode={pallet?.code ?? ""}
            locationCode={target?.code ?? ""}
            pending={pending}
            onConfirm={onPlace}
          />
        </>
      )}
      {movement.status === "completed" && (
        <>
          <div className="ops-success">
            <CheckCircle2 size={16} />
            Размещение подтверждено
          </div>
          {movement.kind === "lower" && pallet && pallet.quantity > 0 && (
            <Link href="/shipments" className="button button--secondary">
              <Package size={16} />К отгрузкам
            </Link>
          )}
        </>
      )}
      {movement.status === "cancelled" && (
        <p>
          Перемещение отменено до забора. Паллета осталась на исходном адресе.
        </p>
      )}
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
