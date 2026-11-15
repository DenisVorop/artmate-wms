"use client";

import { useEffect, type ComponentProps } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Search } from "lucide-react";
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

function FilterSelect(props: ComponentProps<typeof Select>) {
  return (
    <span className={styles.control}>
      <Select {...props} />
      <ChevronDown className={styles.selectIcon} size={16} aria-hidden="true" />
    </span>
  );
}

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
  const { reset, register, formState } = form;
  useEffect(() => {
    reset(values);
  }, [values, reset]);

  return (
    <form
      className={styles.filters}
      aria-label="Фильтры журнала"
      noValidate
      onSubmit={form.handleSubmit((next) => {
        onApply(next);
        reset(next);
      })}
    >
      <div className={styles.filterMain}>
        <label>
          <span>Операция</span>
          <FilterSelect {...register("kind")}>
            <option value="">Все операции</option>
            {Object.values(StockLedgerEventDtoKind).map((kind) => (
              <option key={kind} value={kind}>
                {ledgerKindLabels[kind]}
              </option>
            ))}
          </FilterSelect>
        </label>
        <label>
          <span>Товар</span>
          <FilterSelect {...register("skuId")}>
            <option value="">Все товары</option>
            {data.skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.name}
              </option>
            ))}
          </FilterSelect>
        </label>
        <label>
          <span>Исполнитель</span>
          <FilterSelect {...register("employeeId")}>
            <option value="">Все</option>
            {data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </FilterSelect>
        </label>
        <label>
          <span>На странице</span>
          <FilterSelect {...register("pageSize", { valueAsNumber: true })}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </FilterSelect>
        </label>
      </div>
      <div className={styles.filterPeriod}>
        <label>
          <span>Дата с</span>
          <Input
            type="date"
            {...register("from")}
            aria-invalid={!!formState.errors.from}
          />
        </label>
        <label>
          <span>Дата по</span>
          <Input
            type="date"
            {...register("to")}
            aria-invalid={!!formState.errors.to}
          />
        </label>
        <label className={styles.search}>
          <span>Поиск</span>
          <span className={styles.control}>
            <Search
              className={styles.searchIcon}
              size={16}
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Код, партия, адрес или причина"
              {...register("search")}
              aria-invalid={!!formState.errors.search}
            />
          </span>
        </label>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={() => {
              const defaults = ledgerFilterDefaults();
              reset(defaults);
              onApply(defaults);
            }}
          >
            Сбросить
          </Button>
          <Button type="submit">Применить</Button>
        </div>
      </div>
      {Object.entries(formState.errors).map(([key, issue]) => (
        <p className={styles.error} role="alert" key={key}>
          {issue.message}
        </p>
      ))}
    </form>
  );
}
