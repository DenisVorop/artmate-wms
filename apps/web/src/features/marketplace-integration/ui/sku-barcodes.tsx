"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { SkuDto } from "@/entities/workspace";
import { Button, Select } from "@/shared/ui";
import {
  skuBarcodesSchema,
  type SkuBarcodesValues,
} from "../lib/sku-barcodes-form";
import { useSkuBarcodes } from "../model/use-sku-barcodes";
import styles from "./marketplace-integration.module.css";

export function SkuBarcodes({ skus }: { skus: SkuDto[] }) {
  const [selected, setSelected] = useState("");
  const sku = skus.find((item) => item.id === selected);
  return (
    <details
      className={`glass-panel ${styles.catalog} ${styles.disclosure}`}
      id="sku-barcodes"
    >
      <summary>Штрихкоды тематик</summary>
      <p>
        При сборке WMS принимает основной код и подходящие коды из привязанных
        карточек. Добавьте вручную коды, которых нет в карточках.
      </p>
      <label className="field">
        Тематика
        <Select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Выберите тематику</option>
          {[...skus]
            .sort((a, b) => a.name.localeCompare(b.name, "ru"))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </Select>
      </label>
      {sku && <SkuBarcodesForm key={sku.id} sku={sku} />}
    </details>
  );
}

function SkuBarcodesForm({ sku }: { sku: SkuDto }) {
  const actions = useSkuBarcodes();
  const [saved, setSaved] = useState(false);
  const form = useForm<SkuBarcodesValues>({
    resolver: zodResolver(skuBarcodesSchema),
    defaultValues: { codes: (sku.alternateBarcodes ?? []).join("\n") },
  });
  const error = form.formState.errors.codes?.message ?? actions.error;
  return (
    <form
      className={styles.barcodeForm}
      onSubmit={form.handleSubmit(async ({ codes }) => {
        if (actions.pending) return;
        try {
          const workspace = await actions.save(sku.id, codes);
          const savedSku = workspace.skus.find((item) => item.id === sku.id);
          form.reset({ codes: (savedSku?.alternateBarcodes ?? []).join("\n") });
          setSaved(true);
        } catch {
          setSaved(false);
        }
      })}
    >
      <p>
        Основной штрихкод <strong>{sku.barcode}</strong>
      </p>
      <label className="field">
        Штрихкоды, добавленные вручную
        <textarea
          className="input"
          rows={4}
          placeholder="По одному коду на строку"
          spellCheck={false}
          autoComplete="off"
          disabled={actions.pending}
          aria-invalid={!!error}
          {...form.register("codes", { onChange: () => setSaved(false) })}
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="secondary"
        disabled={actions.pending || !form.formState.isDirty}
      >
        Сохранить штрихкоды
      </Button>
      {saved && <p role="status">Штрихкоды сохранены</p>}
    </form>
  );
}
