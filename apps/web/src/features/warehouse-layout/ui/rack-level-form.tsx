"use client";
import { useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LocationDto, RackSectionDto } from "@/shared/api/generated/model";
import { Button, Modal } from "@/shared/ui";
import {
  levelProfileSchema,
  profileDefaults,
  type LevelProfileValues,
} from "../lib/location-form";
import { nextLevelDefaults } from "../lib/rack-form";
import { ProfileFields } from "./profile-fields";
import styles from "./warehouse-layout.module.css";

type Props = {
  section?: RackSectionDto;
  locations: LocationDto[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (sectionId: string, values: LevelProfileValues) => Promise<void>;
};
export function RackLevelForm({
  section,
  locations,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const methods = useForm<LevelProfileValues>({
    resolver: zodResolver(levelProfileSchema),
    defaultValues: profileDefaults(),
  });
  const { reset, handleSubmit } = methods;
  useEffect(() => {
    if (section) reset(nextLevelDefaults(section, locations));
  }, [section?.id, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  const submit = handleSubmit(async (values) => {
    if (!section) return;
    try {
      await onSave(section.id, values);
      onClose();
    } catch {
      /* API error remains visible. */
    }
  });
  return (
    <Modal
      open={!!section}
      onClose={close}
      title={`Новый ярус · ${section?.code ?? ""}`}
      description="Будет создан отдельный конечный адрес с постоянным QR."
    >
      <FormProvider {...methods}>
        <form onSubmit={submit} className={styles.form}>
          <ProfileFields />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.formFooter}>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Создаём…" : "Создать ярус"}
            </Button>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
