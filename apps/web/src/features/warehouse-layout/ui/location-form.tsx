"use client";
import { useEffect } from "react";
import { WandSparkles } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LocationDtoKind } from "@/shared/api/generated/model";
import type { LocationDto, RackSectionDto } from "@/shared/api/generated/model";
import { Button, Modal, Select } from "@/shared/ui";
import {
  MIN_STORAGE_SIZE_METERS,
  locationDefaults,
  locationKindLabel,
  locationSchema,
  standaloneLocationKinds,
  type LocationFormValues,
} from "../lib/location-form";
import { generateLocationIdentity } from "../lib/location-identity";
import { ProfileFields } from "./profile-fields";
import { GeometryFields } from "./geometry-fields";
import styles from "./warehouse-layout.module.css";

type Props = {
  open: boolean;
  location?: LocationDto;
  sections: RackSectionDto[];
  allLocations: LocationDto[];
  suggestedPosition: { x: number; y: number };
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (
    values: LocationFormValues,
    id?: string,
    isRack?: boolean,
  ) => Promise<void>;
};
export function LocationForm({
  open,
  location,
  sections,
  allLocations,
  suggestedPosition,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const methods = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: locationDefaults(
      location,
      suggestedPosition,
      generateLocationIdentity(sections, allLocations),
    ),
  });
  const { register, reset, handleSubmit, watch, setValue } = methods;
  const kind = watch("kind");
  const isRack = location?.sectionId != null;
  // Snapshot polling must not erase unfinished edits. Reset on opening/address change only.
  useEffect(() => {
    if (open)
      reset(
        location
          ? locationDefaults(location)
          : locationDefaults(
              undefined,
              suggestedPosition,
              generateLocationIdentity(sections, allLocations),
            ),
      );
  }, [open, location?.id, reset]);
  useEffect(() => {
    if (kind === LocationDtoKind.picking) setValue("accessSides", 4);
  }, [kind, setValue]);
  const generateIdentity = () => {
    const identity = generateLocationIdentity(sections, allLocations);
    setValue("code", identity.code, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue("name", identity.name, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };
  const close = () => {
    if (!pending) onClose();
  };
  const submit = handleSubmit(async (values) => {
    try {
      await onSave(values, location?.id, isRack);
      onClose();
    } catch {
      /* API error remains visible. */
    }
  });
  return (
    <Modal
      open={open}
      onClose={close}
      title={location ? `Настройка ${location.code}` : "Новое место"}
      description={
        isRack
          ? "Ограничения и собственный QR выбранного яруса."
          : "Конечный адрес на полу или рабочая зона."
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={submit} className={styles.form}>
          {!isRack && (
            <>
              <label className="field">
                Тип места
                <Select {...register("kind")}>
                  {standaloneLocationKinds.map((value) => (
                    <option key={value} value={value}>
                      {locationKindLabel(value)}
                    </option>
                  ))}
                </Select>
              </label>
              <GeometryFields minimumSize={MIN_STORAGE_SIZE_METERS} />
              <p className={styles.hint}>
                Европаллета — 120 × 80 см. Для груза с выступом новое место
                начинается с 1,2 × 0,9 м, полезные габариты — с 1200 × 900 мм.
                Плановые размеры и ограничения размещения редактируются
                отдельно.
              </p>
            </>
          )}
          {kind === LocationDtoKind.floor && (
            <p className={styles.hint}>
              Напольное место подходит для сырья, готовых коробов и временного
              хранения. Если здесь стоят упаковка или другие вещи без товарного
              учёта, укажите содержимое в названии и включите «Закрыть адрес для
              нового размещения». Тогда система не предложит занятое место как
              свободное.
            </p>
          )}
          {kind === LocationDtoKind.picking && (
            <p className={styles.hint}>
              В зоне отбора паллета доступна с четырёх сторон. Здесь собирают
              отгрузки после спуска со стеллажа.
            </p>
          )}
          <ProfileFields lockAccessSides={kind === LocationDtoKind.picking} />
          {!location && (
            <div className={styles.formSectionHeading}>
              <p className={styles.hint}>
                Адрес и название предложены автоматически; их можно изменить
                вручную. Повторная генерация обновит только эти два поля.
                Свободный адрес проверяется при сохранении.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateIdentity}
                disabled={pending}
                aria-label="Сгенерировать заново адрес и название места"
              >
                <WandSparkles size={14} />
                Сгенерировать заново
              </Button>
            </div>
          )}
          <label className={styles.checkbox}>
            <input type="checkbox" {...register("blocked")} /> Закрыть адрес для
            нового размещения
          </label>
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
              {pending
                ? "Сохраняем…"
                : location
                  ? "Сохранить адрес"
                  : "Создать место"}
            </Button>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
