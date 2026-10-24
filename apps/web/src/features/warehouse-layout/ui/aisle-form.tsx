"use client";
import { useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AisleDto } from "@/shared/api/generated/model";
import { Button, Input, Modal } from "@/shared/ui";
import { aisleDefaults, aisleSchema, type AisleValues } from "../lib/plan-form";
import { GeometryFields } from "./geometry-fields";
import styles from "./plan-panels.module.css";

type Props = {
  open: boolean;
  aisle?: AisleDto;
  suggestedPosition?: { x: number; y: number };
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: AisleValues, id?: string) => Promise<unknown>;
};
export function AisleForm({
  open,
  aisle,
  suggestedPosition,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const methods = useForm<AisleValues>({
    resolver: zodResolver(aisleSchema),
    defaultValues: aisleDefaults(aisle),
  });
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = methods;
  useEffect(() => {
    if (open)
      reset(
        aisle
          ? aisleDefaults(aisle)
          : { ...aisleDefaults(), ...suggestedPosition },
      );
  }, [open, aisle?.id, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={aisle ? `Проход · ${aisle.name}` : "Новый проход"}
      description="Свободное пространство для движения по складу."
    >
      <FormProvider {...methods}>
        <form
          className={styles.form}
          onSubmit={handleSubmit(async (values) => {
            try {
              await onSave(values, aisle?.id);
              onClose();
            } catch {
              /* Keep edits when the server rejects geometry. */
            }
          })}
        >
          <fieldset className={styles.fieldset} disabled={pending}>
            <label className="field">
              Название прохода
              <Input
                {...register("name")}
                placeholder="Главный проход"
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <span className={styles.fieldError}>{errors.name.message}</span>
              )}
            </label>
            <GeometryFields />
          </fieldset>
          <p className={styles.hint}>
            Проходы могут пересекаться между собой. Места хранения и секции не
            должны перекрывать проход. Проход не имеет адреса хранения и QR.
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.footer}>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {aisle ? "Сохранить проход" : "Добавить проход"}
            </Button>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
