"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  marketplaceDate,
  providerName,
  type MarketplaceConnectionDto,
} from "@/entities/marketplaces";
import { Button, Input, Modal } from "@/shared/ui";
import {
  connectionDefaults,
  connectionSchemaFor,
  type ConnectionValues,
} from "../lib/integration-form";
import { isFreshMarketplaceSync } from "../lib/connection-state";
import styles from "./marketplace-integration.module.css";

export function ConnectionCard({
  connection,
  pending,
  error,
  onClearError,
  onSave,
  onSync,
  onToggle,
}: {
  connection: MarketplaceConnectionDto;
  pending: boolean;
  error: string | null;
  onClearError: () => void;
  onSave: (values: ConnectionValues) => Promise<boolean>;
  onSync: () => Promise<boolean>;
  onToggle: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const form = useForm<ConnectionValues>({
    resolver: zodResolver(connectionSchemaFor(connection.provider)),
    defaultValues: connectionDefaults,
  });

  const fresh = isFreshMarketplaceSync(connection);
  const busy = pending || fresh;
  const failed =
    connection.syncStatus === "failed" ||
    (connection.syncStatus === "running" && !fresh);
  const status = !connection.configured
    ? "Не подключён"
    : !connection.enabled
      ? "Отключён"
      : fresh
        ? "Обновляется"
        : failed
          ? "Ошибка загрузки"
          : connection.syncStatus === "partial"
            ? "Неполные данные"
            : connection.lastSuccessAt
              ? "Подключён"
              : "Ожидает обновления";
  const name = providerName(connection.provider);
  const close = () => {
    if (pending) return;
    onClearError();
    form.reset(connectionDefaults);
    setEditing(false);
    setOpen(false);
  };

  return (
    <article className={styles.connection}>
      <div>
        <h2>{name}</h2>
        <p
          className={
            connection.enabled &&
            (failed || connection.syncStatus === "partial")
              ? styles.warning
              : styles.footnote
          }
        >
          {status}
          {connection.enabled && connection.lastSuccessAt && (
            <> · Данные на {marketplaceDate(connection.lastSuccessAt)}</>
          )}
        </p>
      </div>
      <Button
        aria-label={
          connection.configured ? `Настройки ${name}` : `Подключить ${name}`
        }
        aria-haspopup="dialog"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          onClearError();
          setEditing(!connection.configured);
          setOpen(true);
        }}
      >
        {connection.configured ? "Настройки" : "Подключить"}
      </Button>
      <Modal
        open={open}
        title={
          connection.configured ? `Подключение ${name}` : `Подключить ${name}`
        }
        onClose={close}
      >
        {open && (
          <div className={styles.productDetail}>
            {connection.configured && !editing && (
              <>
                <p className={styles.footnote}>{status}</p>
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !connection.enabled}
                    onClick={() => void onSync()}
                  >
                    Обновить данные
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      onClearError();
                      setEditing(true);
                    }}
                  >
                    Заменить ключ
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onToggle()}
                  >
                    {connection.enabled ? "Отключить" : "Включить"}
                  </Button>
                </div>
              </>
            )}
            {(editing || !connection.configured) && (
              <form
                className={styles.form}
                noValidate
                onSubmit={form.handleSubmit(async (values) => {
                  if (busy || !(await onSave(values))) return;
                  form.reset(connectionDefaults);
                  setEditing(false);
                  setOpen(false);
                })}
              >
                {connection.provider === "ozon" && (
                  <label className="field">
                    Client ID
                    <Input
                      {...form.register("clientId")}
                      aria-label="Client ID"
                      aria-describedby={
                        form.formState.errors.clientId
                          ? `${fieldId}-client-error`
                          : undefined
                      }
                      autoComplete="off"
                      inputMode="numeric"
                      disabled={busy}
                      aria-invalid={!!form.formState.errors.clientId}
                    />
                    {form.formState.errors.clientId && (
                      <span
                        className={styles.error}
                        id={`${fieldId}-client-error`}
                      >
                        {form.formState.errors.clientId.message}
                      </span>
                    )}
                  </label>
                )}
                <label className="field">
                  API-ключ
                  <Input
                    {...form.register("apiKey")}
                    aria-label="API-ключ"
                    aria-describedby={
                      form.formState.errors.apiKey
                        ? `${fieldId}-key-error`
                        : undefined
                    }
                    type="password"
                    autoComplete="new-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    aria-invalid={!!form.formState.errors.apiKey}
                  />
                  {form.formState.errors.apiKey && (
                    <span className={styles.error} id={`${fieldId}-key-error`}>
                      {form.formState.errors.apiKey.message}
                    </span>
                  )}
                </label>
                <p className={styles.footnote}>
                  {connection.provider === "wildberries"
                    ? "Ключ на чтение: «Контент», «Статистика», «Аналитика» и «Поставки»."
                    : "Ключ на чтение каталога, FBO и аналитики остатков."}
                </p>
                <div className={styles.actions}>
                  <Button type="submit" disabled={busy}>
                    Сохранить ключ
                  </Button>
                </div>
              </form>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </article>
  );
}
