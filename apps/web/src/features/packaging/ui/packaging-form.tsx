"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Modal } from "@/shared/ui";
import type { SkuDto } from "@/shared/api/generated/model";
import {
  packagingSchema,
  packagingDefaults,
  type PackagingValues,
} from "../lib/packaging-form";
import { usePackaging } from "../model/use-packaging";
export function PackagingForm({
  sku,
  onClose,
}: {
  sku: SkuDto;
  onClose: () => void;
}) {
  const command = usePackaging();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PackagingValues>({
    resolver: zodResolver(packagingSchema),
    defaultValues: packagingDefaults(sku.packaging),
  });
  const dimensions: [keyof PackagingValues, string][] = [
    ["boxWidthMm", "Ширина короба, мм"],
    ["boxDepthMm", "Глубина короба, мм"],
    ["boxHeightMm", "Высота короба, мм"],
    ["palletWidthMm", "Ширина поддона, мм"],
    ["palletDepthMm", "Глубина поддона, мм"],
    ["loadWidthMm", "Ширина загруженной паллеты, мм"],
    ["loadDepthMm", "Глубина загруженной паллеты, мм"],
    ["palletBaseHeightMm", "Высота поддона, мм"],
    ["boxesPerLayer", "Коробов в слое"],
    ["maxLayers", "Максимум слоёв"],
  ];
  return (
    <Modal
      open
      title={`Упаковка · ${sku.name}`}
      onClose={onClose}
      description="Размеры и проверенная схема укладки"
    >
      <form
        className="ops-form ops-profile-form"
        onSubmit={handleSubmit(async (values) => {
          try {
            await command.save(sku.id, values);
            onClose();
          } catch {}
        })}
      >
        <div className="ops-form-grid">
          {dimensions.map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type="number"
                min={
                  field === "loadWidthMm"
                    ? watch("palletWidthMm")
                    : field === "loadDepthMm"
                      ? watch("palletDepthMm")
                      : 1
                }
                readOnly={
                  field === "palletWidthMm" || field === "palletDepthMm"
                }
                {...register(field, { valueAsNumber: true })}
              />
              {errors[field] && (
                <span className="ops-field-error">
                  {errors[field]?.message ?? "Проверьте значение"}
                </span>
              )}
            </label>
          ))}
        </div>
        <p className="ops-description">
          Габариты загруженной паллеты включают поддон и выступающие короба. По
          ним проверяется, поместится ли груз на адресе. Размер основания
          поддона сохраняется отдельно.
        </p>
        <fieldset>
          <legend>Масса для проверки грузоподъёмности</legend>
          <div className="ops-form-grid">
            <label>
              Один полный короб, кг
              <input
                type="number"
                step="0.01"
                min={0.01}
                placeholder="Неизвестна"
                {...register("boxWeightKg", {
                  setValueAs: (v) =>
                    v === "" || v === null ? null : Number(v),
                })}
              />
              {errors.boxWeightKg && (
                <span className="ops-field-error">
                  Укажите положительную массу
                </span>
              )}
            </label>
            <label>
              Пустой поддон, кг
              <input
                type="number"
                step="0.1"
                min={0.1}
                placeholder="Неизвестна"
                {...register("palletWeightKg", {
                  setValueAs: (v) =>
                    v === "" || v === null ? null : Number(v),
                })}
              />
              {errors.palletWeightKg && (
                <span className="ops-field-error">
                  Укажите положительную массу
                </span>
              )}
            </label>
          </div>
        </fieldset>
        <p className="ops-description">
          Изменение применяется к новой сборке. Упакованные короба сохраняют
          свои размеры и происхождение. Пока есть незавершённое задание этой
          тематики, изменение профиля недоступно.
        </p>
        {command.error && (
          <div className="ops-error" role="alert">
            {command.error}
          </div>
        )}
        <Button disabled={command.pending} type="submit">
          {command.pending ? "Сохраняем…" : "Сохранить профиль"}
        </Button>
      </form>
    </Modal>
  );
}
