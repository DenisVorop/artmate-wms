"use client";
import { useSession } from "@/entities/session";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Modal, Select } from "@/shared/ui";
import {
  canReturn,
  wholePalletMovementAllowed,
  movementDefaults,
  movementSchema,
  targetHint,
  type MovementValues,
} from "../lib/movement-form";
import styles from "./movements.module.css";

type Props = {
  open: boolean;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (values: MovementValues) => Promise<unknown>;
};
export function MovementCreateForm({
  open,
  data,
  pending,
  error,
  onClose,
  onCreate,
}: Props) {
  const { user, isManager } = useSession();
  const {
    register,
    watch,
    reset,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<MovementValues>({
    resolver: zodResolver(movementSchema),
    defaultValues: movementDefaults,
  });
  const ownEmployee = data.employees.find(
    (employee) => employee.id === user?.employeeId,
  );
  const [palletId, kind] = watch(["palletId", "kind"]);
  const pallet = data.pallets.find((item) => item.id === palletId);
  const available = data.pallets.filter(
    (item) =>
      wholePalletMovementAllowed(data, item) &&
      item.status === "stored" &&
      item.quantity > 0 &&
      (kind !== "return" || canReturn(data, item)) &&
      !data.movements.some(
        (movement) =>
          movement.palletId === item.id &&
          ["planned", "in_transit"].includes(movement.status),
      ),
  );
  useEffect(() => {
    if (open)
      reset({
        ...movementDefaults,
        employeeId: isManager ? "" : (user?.employeeId ?? ""),
      });
  }, [open, reset, isManager, user?.employeeId]);
  useEffect(() => {
    setValue("keepSourceReserved", kind === "lower");
    setValue(
      "toLocationId",
      kind === "return" ? (pallet?.returnLocationId ?? "") : "",
    );
  }, [kind, palletId, pallet?.returnLocationId, setValue]);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Новое перемещение"
    >
      <form
        className={styles.form}
        onSubmit={handleSubmit(async (values) => {
          if (pending) return;
          try {
            await onCreate(values);
            onClose();
          } catch {
            /* API error remains beside the form. */
          }
        })}
      >
        <label className="field">
          Паллета
          <Select disabled={pending} {...register("palletId")}>
            <option value="">Выберите паллету</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} ·{" "}
                {data.skus.find((sku) => sku.id === item.skuId)?.name} ·{" "}
                {
                  data.locations.find(
                    (location) => location.id === item.locationId,
                  )?.code
                }
              </option>
            ))}
          </Select>
          {errors.palletId && (
            <span className={styles.fieldError}>{errors.palletId.message}</span>
          )}
        </label>
        <label className="field">
          Операция
          <Select disabled={pending} {...register("kind")}>
            <option value="transfer">Перемещение на другой адрес</option>
            <option value="lower" disabled={!!pallet?.returnLocationId}>
              Спуск для отбора с четырёх сторон
            </option>
            <option
              value="return"
              disabled={!!pallet && !canReturn(data, pallet)}
            >
              Возврат остатка на хранение
            </option>
          </Select>
        </label>
        {kind === "return" && pallet && (
          <div className={styles.hint}>
            {pallet.returnLocationId ? (
              <>
                Удерживаемый адрес возврата:{" "}
                <strong>
                  {
                    data.locations.find(
                      (item) => item.id === pallet.returnLocationId,
                    )?.code
                  }
                </strong>
                . Остаток:{" "}
                <strong>
                  {pallet.quantity} {pallet.kind === "raw" ? "шт." : "кор."}
                </strong>
              </>
            ) : (
              "Адрес возврата не зарезервирован. Выберите свободное место хранения."
            )}
          </div>
        )}
        {kind === "transfer" && pallet?.returnLocationId && (
          <p className={styles.hint}>
            Адрес возврата{" "}
            <strong>
              {
                data.locations.find(
                  (item) => item.id === pallet.returnLocationId,
                )?.code
              }
            </strong>{" "}
            сохранится.
          </p>
        )}
        <label className="field">
          Целевой адрес
          <Select disabled={pending} {...register("toLocationId")}>
            <option value="">Выберите адрес</option>
            {data.locations
              .filter((l) => !l.archived)
              .filter((item) =>
                kind === "lower"
                  ? item.kind === "picking" && item.accessSides === 4
                  : kind === "return"
                    ? pallet?.returnLocationId
                      ? item.id === pallet.returnLocationId
                      : ["rack", "floor"].includes(item.kind)
                    : true,
              )
              .map((item) => {
                const hint = targetHint(data, item.id, pallet, kind);
                return (
                  <option key={item.id} value={item.id} disabled={!!hint}>
                    {item.code} · {item.name}
                    {hint ? ` — ${hint}` : ""}
                  </option>
                );
              })}
          </Select>
          {errors.toLocationId && (
            <span className={styles.fieldError}>
              {errors.toLocationId.message}
            </span>
          )}
        </label>
        {isManager ? (
          <>
            <label className="field">
              Исполнитель
              <Select disabled={pending} {...register("employeeId")}>
                <option value="">Выберите сотрудника на смене</option>
                {data.employees
                  .filter((item) => item.status === "working")
                  .map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={data.putawayTasks.some(
                        (task) =>
                          task.employeeId === item.id &&
                          ["claimed", "in_transit"].includes(task.status),
                      )}
                    >
                      {item.name}
                      {data.putawayTasks.some(
                        (task) =>
                          task.employeeId === item.id &&
                          ["claimed", "in_transit"].includes(task.status),
                      )
                        ? " — размещает короб"
                        : ""}
                    </option>
                  ))}
              </Select>
              {errors.employeeId && (
                <span className={styles.fieldError}>
                  {errors.employeeId.message}
                </span>
              )}
            </label>
          </>
        ) : (
          <>
            <input type="hidden" {...register("employeeId")} />
            <p className={styles.hint}>
              Исполнитель: {user?.name}. Задание будет назначено вам.
            </p>
          </>
        )}
        {kind === "lower" && (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              disabled={pending}
              {...register("keepSourceReserved")}
            />
            <span>Сохранить исходный адрес для возврата остатка</span>
          </label>
        )}
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        {!isManager && ownEmployee?.status !== "working" && (
          <p className={styles.hint}>
            Для создания своего перемещения начните смену в разделе «Команда».
          </p>
        )}
        <Button
          type="submit"
          disabled={
            pending || (!isManager && ownEmployee?.status !== "working")
          }
        >
          {pending ? "Создаём…" : "Создать"}
        </Button>
      </form>
    </Modal>
  );
}
