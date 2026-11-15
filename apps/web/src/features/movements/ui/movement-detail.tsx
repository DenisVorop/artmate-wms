"use client";
import { useSession } from "@/entities/session";
import { ArrowRight } from "lucide-react";
import type { MovementDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import {
  movementTime,
  movementPalletName,
  movementTitle,
  movementClaimHint,
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
  onClaim: () => Promise<unknown>;
  onTake: (values: ScanValues) => Promise<unknown>;
  onPlace: (values: ScanValues) => Promise<unknown>;
  onCancel: () => Promise<unknown>;
};
export function MovementDetail({
  movement,
  data,
  pending,
  error,
  onClaim,
  onTake,
  onPlace,
  onCancel,
}: Props) {
  const { user, isManager } = useSession();
  const canExecute =
    user?.employeeId === movement.employeeId &&
    data.employees.some(
      (employee) =>
        employee.id === user.employeeId && employee.status === "working",
    );
  const free =
    movement.autoPurpose === "accessible_raw" &&
    movement.employeeId === null &&
    movement.status === "planned";
  const claimHint = movementClaimHint(data, user?.employeeId, movement.id);
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
  const employee = data.employees.find(
    (item) => item.id === movement.employeeId,
  );
  return (
    <section
      className={`glass-panel ${styles.detail}`}
      aria-label={`Перемещение ${movement.code}`}
    >
      <header className={styles.detailHeader}>
        <div>
          <h2>{movementPalletName(data, pallet)}</h2>
          <p>
            {movement.code} · {movementTitle(movement)}
            {pallet && (
              <>
                {" "}
                · {pallet.code} · {pallet.quantity}{" "}
                {pallet.kind === "raw" ? "шт." : "кор."}
              </>
            )}
            {employee && <> · {employee.name}</>}
          </p>
        </div>
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
      </header>
      <div className={styles.addresses}>
        <div className={styles.address}>
          <span>Откуда</span>
          <strong>{source?.code ?? "—"}</strong>
          {source?.kind === "rack" && <span>Ярус {source.level}</span>}
        </div>
        <ArrowRight size={20} className={styles.arrow} aria-hidden="true" />
        <div className={styles.address}>
          <span>Куда</span>
          <strong>{target?.code ?? "—"}</strong>
          {target?.kind === "rack" && <span>Ярус {target.level}</span>}
        </div>
      </div>
      {movement.keepSourceReserved &&
        movement.kind === "lower" &&
        movement.status !== "cancelled" && (
          <p className={styles.hint}>
            {movement.status === "planned" ? (
              "После забора исходный адрес будет удерживаться для возврата."
            ) : held ? (
              <>
                Адрес возврата зарезервирован: <strong>{held.code}</strong>.
              </>
            ) : (
              "Исходный адрес больше не удерживается."
            )}
          </p>
        )}
      {!["completed", "cancelled"].includes(movement.status) &&
        !canExecute &&
        !free && (
          <p className={styles.context}>
            {user?.employeeId === movement.employeeId
              ? "Начните смену, чтобы продолжить."
              : "Сканы принимает только учётная запись исполнителя."}
          </p>
        )}
      {movement.status === "planned" && (
        <>
          {free &&
            (claimHint ? (
              <p className={styles.context}>{claimHint}</p>
            ) : (
              <Button
                className={styles.action}
                disabled={pending}
                onClick={() => void onClaim().catch(() => {})}
              >
                Взять задание
              </Button>
            ))}
          {canExecute && (
            <MovementConfirmForm
              key={`${movement.id}-take`}
              mode="take"
              palletCode={pallet?.code ?? ""}
              locationCode={source?.code ?? ""}
              pending={pending}
              onConfirm={onTake}
            />
          )}
          {(isManager || user?.employeeId === movement.employeeId) && (
            <Button
              className={styles.action}
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => void onCancel().catch(() => {})}
            >
              Отменить до забора
            </Button>
          )}
        </>
      )}
      {movement.status === "in_transit" && canExecute && (
        <MovementConfirmForm
          key={`${movement.id}-place`}
          mode="place"
          palletCode={pallet?.code ?? ""}
          locationCode={target?.code ?? ""}
          pending={pending}
          onConfirm={onPlace}
        />
      )}
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
      <div className={styles.history}>
        <span>
          Создано <strong>{movementTime(movement.createdAt)}</strong>
        </span>
        {movement.takenAt && (
          <span>
            Забрано <strong>{movementTime(movement.takenAt)}</strong>
          </span>
        )}
        {movement.completedAt && (
          <span>
            Размещено <strong>{movementTime(movement.completedAt)}</strong>
          </span>
        )}
      </div>
    </section>
  );
}
