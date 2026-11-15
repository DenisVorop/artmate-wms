"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SkuDto } from "@/entities/workspace";
import {
  providerName,
  type MarketplaceProductDto,
} from "@/entities/marketplaces";
import { Button, Input, Select } from "@/shared/ui";
import { mappingSchema, type MappingValues } from "../lib/integration-form";
import styles from "./marketplace-integration.module.css";
export function ProductMapping({
  product,
  skus,
  pending,
  error,
  onSave,
}: {
  product: MarketplaceProductDto;
  skus: SkuDto[];
  pending: boolean;
  error: string | null;
  onSave: (values: MappingValues) => Promise<boolean>;
}) {
  const form = useForm<MappingValues>({
    resolver: zodResolver(mappingSchema),
    defaultValues: {
      skuId: product.skuId ?? "",
      unitsPerItem: product.unitsPerItem,
    },
  });
  const suggestion = skus.find((sku) => sku.id === product.suggestedSkuId);
  return (
    <div className={styles.productDetail}>
      <dl className={styles.facts}>
        <div>
          <dt>Площадка</dt>
          <dd>{providerName(product.provider)}</dd>
        </div>
        <div>
          <dt>Артикул</dt>
          <dd>{product.offerId || product.externalId}</dd>
        </div>
        <div>
          <dt>Штрихкоды</dt>
          <dd>{product.barcodes.join(", ") || "—"}</dd>
        </div>
      </dl>
      {!skus.length && (
        <p className={styles.footnote}>Нет доступных тематик склада.</p>
      )}
      <form
        className={styles.mapping}
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending && (await onSave(values))) form.reset(values);
        })}
      >
        <label className="field">
          Тематика WMS
          <Select
            {...form.register("skuId")}
            disabled={pending || !skus.length}
            aria-invalid={!!form.formState.errors.skuId}
          >
            <option value="">Выберите тематику</option>
            {skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          Единиц в товаре
          <Input
            type="number"
            min={1}
            max={10000}
            {...form.register("unitsPerItem", { valueAsNumber: true })}
            disabled={pending}
            aria-invalid={!!form.formState.errors.unitsPerItem}
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending || !skus.length || !form.formState.isDirty}
        >
          Сохранить
        </Button>
        {(form.formState.errors.skuId ||
          form.formState.errors.unitsPerItem) && (
          <span className={styles.error}>
            {form.formState.errors.skuId?.message ||
              form.formState.errors.unitsPerItem?.message}
          </span>
        )}
        {!product.skuId && suggestion && (
          <div className={styles.suggestion}>
            Совпадение по штрихкоду:
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                form.setValue("skuId", suggestion.id, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            >
              {suggestion.name}
            </Button>
          </div>
        )}
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </form>
    </div>
  );
}
