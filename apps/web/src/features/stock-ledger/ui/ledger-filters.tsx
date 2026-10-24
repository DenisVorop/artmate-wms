"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Search, SlidersHorizontal } from "lucide-react";
import {
  StockLedgerEventDtoKind,
  type WorkspaceDto,
} from "@/shared/api/generated/model";
import { Button, Input, Select } from "@/shared/ui";
import {
  ledgerFilterDefaults,
  ledgerFilterSchema,
  type LedgerFilterValues,
} from "../lib/ledger-filter";
import { ledgerKindLabels } from "../lib/ledger-view";
import styles from "./stock-ledger.module.css";
export function LedgerFilters({
  data,
  values,
  onApply,
}: {
  data: WorkspaceDto;
  values: LedgerFilterValues;
  onApply: (values: LedgerFilterValues) => void;
}) {
  const form = useForm<LedgerFilterValues>({
    resolver: zodResolver(ledgerFilterSchema),
    defaultValues: values,
  });
  const { reset } = form;
  useEffect(() => {
    reset(values);
  }, [values, reset]);
  return (
    <section
      className={`glass-panel ${styles.filters}`}
      aria-label="Фильтры журнала"
    >
      <div className={styles.filterHeading}>
        <h2>
          <SlidersHorizontal size={16} />
          Фильтры операций
        </h2>
        <span>Даты — по Москве</span>
      </div>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => {
          onApply(values);
          form.reset(values);
        })}
      >
        <div className={styles.filterGrid}>
          <label className="field">
            Операция
            <Select {...form.register("kind")}>
              <option value="">Все операции</option>
              {Object.values(StockLedgerEventDtoKind).map((kind) => (
                <option key={kind} value={kind}>
                  {ledgerKindLabels[kind]}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            Тематика
            <Select {...form.register("skuId")}>
              <option value="">Все тематики</option>
              {data.skus.map((sku) => (
                <option key={sku.id} value={sku.id}>
                  {sku.name} · {sku.code}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            Исполнитель
            <Select {...form.register("employeeId")}>
              <option value="">Все исполнители</option>
              {data.employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            Дата с
            <Input
              type="date"
              {...form.register("from")}
              aria-invalid={!!form.formState.errors.from}
            />
            {form.formState.errors.from && (
              <span className={styles.error}>
                {form.formState.errors.from.message}
              </span>
            )}
          </label>
          <label className="field">
            Дата по
            <Input
              type="date"
              {...form.register("to")}
              aria-invalid={!!form.formState.errors.to}
            />
            {form.formState.errors.to && (
              <span className={styles.error}>
                {form.formState.errors.to.message}
              </span>
            )}
          </label>
          <label className="field">
            Операций на странице
            <Select {...form.register("pageSize", { valueAsNumber: true })}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </Select>
          </label>
        </div>
        <div className={styles.filterBottom}>
          <label className={styles.search}>
            <Search size={15} />
            <Input
              placeholder="Код, партия, адрес или причина"
              aria-label="Поиск в журнале"
              {...form.register("search")}
              aria-invalid={!!form.formState.errors.search}
            />
          </label>
          <div className={styles.actions}>
            <Button
              variant="ghost"
              onClick={() => {
                const next = ledgerFilterDefaults();
                form.reset(next);
                onApply(next);
              }}
            >
              Сбросить фильтры
            </Button>
            <Button type="submit">Применить</Button>
          </div>
        </div>
        {form.formState.errors.search && (
          <p className={styles.error}>{form.formState.errors.search.message}</p>
        )}
      </form>
    </section>
  );
}
