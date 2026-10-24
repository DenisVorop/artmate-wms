"use client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Modal, Select } from "@/shared/ui";
import { assemblySchema, type AssemblyValues } from "../lib/assembly-form";
import styles from "./assembly.module.css";
export function TaskCreateForm({
  data,
  pending,
  error,
  onClose,
  onSave,
}: {
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: AssemblyValues) => Promise<void>;
}) {
  const form = useForm<AssemblyValues>({
    resolver: zodResolver(assemblySchema),
    defaultValues: { skuId: "", boxesTarget: 2, employeeId: "" },
  });
  const sku = data.skus.find((item) => item.id === form.watch("skuId"));
  return (
    <Modal
      open
      title="Новое задание на сборку"
      description="Короба собираются в запас. Исполнителя можно назначить сейчас или позднее; свободное задание сотрудник возьмёт сам."
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        className={styles.createForm}
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending) await onSave(values);
        })}
        aria-busy={pending}
      >
        <fieldset className={styles.fieldset} disabled={pending}>
          <label className="field">
            Тематика
            <Select
              {...form.register("skuId")}
              aria-invalid={!!form.formState.errors.skuId}
            >
              <option value="">Выберите тематику</option>
              {data.skus.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.unitsPerBox} шт./кор.
                </option>
              ))}
            </Select>
            {form.formState.errors.skuId && (
              <span className={styles.error}>
                {form.formState.errors.skuId.message}
              </span>
            )}
          </label>
          {!data.skus.length && (
            <p className={styles.info}>
              В каталоге пока нет тематик.{" "}
              <Link target="_blank" href="/receiving" rel="noopener noreferrer">
                Создайте приёмку ↗
              </Link>
              , затем вернитесь к заданию.
            </p>
          )}
          <label className="field">
            Сколько коробов собрать
            <Input
              type="number"
              min={1}
              max={1000}
              step={1}
              {...form.register("boxesTarget", { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.boxesTarget}
            />
            {form.formState.errors.boxesTarget && (
              <span className={styles.error}>
                {form.formState.errors.boxesTarget.message}
              </span>
            )}
          </label>
          <label className="field">
            Исполнитель · необязательно
            <Select {...form.register("employeeId")}>
              <option value="">Свободная очередь</option>
              {data.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                  {employee.status === "working"
                    ? " · на смене"
                    : " · вне смены"}
                </option>
              ))}
            </Select>
          </label>
        </fieldset>
        {sku && (
          <p className={styles.info}>
            В коробе {sku.unitsPerBox} раскрасок. При создании сервер
            резервирует товар по FIFO; короб собирается только после
            подтверждения источника и своей этикетки.
          </p>
        )}
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        <div className={styles.actions}>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={pending || !data.skus.length}
            aria-busy={pending}
          >
            Создать задание
          </Button>
        </div>
      </form>
    </Modal>
  );
}
