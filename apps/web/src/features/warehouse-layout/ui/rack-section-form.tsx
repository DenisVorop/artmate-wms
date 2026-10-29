"use client";
import { useEffect } from "react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, WandSparkles } from "lucide-react";
import type { LocationDto, RackSectionDto } from "@/shared/api/generated/model";
import { Button, Input, Modal } from "@/shared/ui";
import { MIN_STORAGE_SIZE_METERS, profileDefaults } from "../lib/location-form";
import {
  newSectionSchema,
  sectionDefaults,
  sectionEditSchema,
  type SectionFormValues,
} from "../lib/rack-form";
import { ProfileFields } from "./profile-fields";
import { GeometryFields } from "./geometry-fields";
import { generateSectionIdentity } from "../lib/section-identity";
import styles from "./warehouse-layout.module.css";

type Props = {
  open: boolean;
  section?: RackSectionDto;
  locations: LocationDto[];
  sections: RackSectionDto[];
  allLocations: LocationDto[];
  suggestedPosition: { x: number; y: number };
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: SectionFormValues, id?: string) => Promise<void>;
};
export function RackSectionForm({
  open,
  section,
  locations,
  sections,
  allLocations,
  suggestedPosition,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const methods = useForm<SectionFormValues>({
    resolver: zodResolver(section ? sectionEditSchema : newSectionSchema),
    defaultValues: sectionDefaults(
      section,
      locations,
      generateSectionIdentity(sections, allLocations),
    ),
  });
  const {
    register,
    reset,
    control,
    getValues,
    setValue,
    handleSubmit,
    formState: { errors },
  } = methods;
  const { fields, append, remove } = useFieldArray({ control, name: "levels" });
  useEffect(() => {
    if (open)
      reset(
        section
          ? sectionDefaults(section, locations)
          : {
              ...sectionDefaults(
                undefined,
                [],
                generateSectionIdentity(sections, allLocations),
              ),
              ...suggestedPosition,
            },
      );
  }, [open, section?.id, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  function fillAddresses() {
    const code = getValues("code").trim();
    const name = getValues("name").trim();
    fields.forEach((_, index) => {
      setValue(
        `levels.${index}.code`,
        `${code || "СЕКЦИЯ"}-${String(index + 1).padStart(2, "0")}`,
        { shouldValidate: true },
      );
      setValue(
        `levels.${index}.name`,
        `${name || "Секция"} · Ярус ${index + 1}`,
        { shouldValidate: true },
      );
    });
  }
  function appendLevel() {
    const previous = getValues(`levels.${fields.length - 1}`);
    const code = getValues("code").trim();
    const name = getValues("name").trim();
    append({
      ...(previous ?? profileDefaults()),
      code: code ? `${code}-${String(fields.length + 1).padStart(2, "0")}` : "",
      name: name ? `${name} · Ярус ${fields.length + 1}` : "",
    });
  }
  function generateIdentity() {
    const identity = generateSectionIdentity(sections, allLocations);
    setValue("code", identity.code, { shouldValidate: true });
    setValue("name", identity.name, { shouldValidate: true });
    fillAddresses();
  }
  const submit = handleSubmit(async (values) => {
    try {
      await onSave(values, section?.id);
      onClose();
    } catch {
      /* API error remains visible. */
    }
  });
  return (
    <Modal
      open={open}
      onClose={close}
      title={section ? `Секция ${section.code}` : "Новая секция стеллажа"}
      description="Секция занимает одно место на плане. У каждого яруса собственный адрес и QR."
    >
      <FormProvider {...methods}>
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.formGrid}>
            <label className="field">
              Код секции
              <Input
                {...register("code")}
                placeholder="A-01"
                aria-invalid={!!errors.code}
              />
              {errors.code && (
                <span className={styles.fieldError}>{errors.code.message}</span>
              )}
            </label>
            <label className="field">
              Название секции
              <Input
                {...register("name")}
                placeholder="Секция A · Первая"
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <span className={styles.fieldError}>{errors.name.message}</span>
              )}
            </label>
          </div>
          {!section && (
            <div className={styles.formSectionHeading}>
              <p className={styles.hint}>
                Код, название и адреса ярусов заполнены автоматически. Можно
                изменить их вручную или подставить заново.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateIdentity}
                disabled={pending}
                aria-label="Сгенерировать код и название секции и адреса ярусов"
              >
                <WandSparkles size={14} />
                Сгенерировать заново
              </Button>
            </div>
          )}
          <GeometryFields minimumSize={MIN_STORAGE_SIZE_METERS} />
          <p className={styles.hint}>
            Европаллета — 120 × 80 см. Для груза с выступом новой секции
            предложено 1,2 × 0,9 м и полезные 1200 × 900 мм на ярус. Изменение
            размеров плана не подгоняет ограничения ярусов.
          </p>
          {section ? (
            <p className={styles.hint}>
              Положение и размеры синхронизируются со всеми ярусами секции.
              Ограничения яруса меняются в его карточке.
            </p>
          ) : (
            <>
              <div className={styles.formSectionHeading}>
                <h3>Ярусы и адреса</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fillAddresses}
                  disabled={pending}
                >
                  <WandSparkles size={14} />
                  Подставить адреса
                </Button>
              </div>
              {fields.map((field, index) => (
                <fieldset
                  className={styles.profileFieldset}
                  key={field.id}
                  disabled={pending}
                >
                  <legend>Ярус {index + 1}</legend>
                  <ProfileFields prefix={`levels.${index}`} />
                  {fields.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                    >
                      <Trash2 size={14} />
                      Убрать из новой секции
                    </Button>
                  )}
                </fieldset>
              ))}
              {errors.levels?.root && (
                <p className={styles.fieldError}>
                  {errors.levels.root.message}
                </p>
              )}
              <Button
                variant="secondary"
                onClick={appendLevel}
                disabled={pending || fields.length >= 20}
              >
                <Plus size={15} />
                Добавить ярус в секцию
              </Button>
            </>
          )}
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
                : section
                  ? "Сохранить секцию"
                  : "Создать секцию"}
            </Button>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
