"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SkuDto } from "@/entities/workspace";
import {
  providerName,
  type MarketplaceProductDto,
} from "@/entities/marketplaces";
import { Badge, Button, Input, Select } from "@/shared/ui";
import { mappingSchema, type MappingValues } from "../lib/integration-form";
import styles from "./marketplace-integration.module.css";
export function ProductMapping({
  product,
  skus,
  pending,
  onSave,
}: {
  product: MarketplaceProductDto;
  skus: SkuDto[];
  pending: boolean;
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
    <article className={styles.product}>
      <div>
        <Badge tone={product.skuId ? "success" : "warning"}>
          {providerName(product.provider)} ·{" "}
          {product.skuId ? "Сопоставлено" : "Нужна тематика"}
        </Badge>
        <h3>{product.name}</h3>
        <code>{product.offerId || product.externalId}</code>
        <small>
          Штрихкоды:{" "}
          {product.barcodes.length
            ? product.barcodes.join(", ")
            : "не переданы"}
        </small>
      </div>
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
            disabled={pending}
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
          disabled={pending || !form.formState.isDirty}
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
            Совпал штрихкод: {suggestion.name}
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
              Выбрать
            </Button>
            <span>Сохраните соответствие вручную.</span>
          </div>
        )}
      </form>
    </article>
  );
}
