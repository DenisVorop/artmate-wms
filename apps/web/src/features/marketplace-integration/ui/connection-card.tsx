"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCw } from "lucide-react";
import {
  marketplaceDate,
  providerName,
  type MarketplaceConnectionDto,
} from "@/entities/marketplaces";
import { Badge, Button, Input } from "@/shared/ui";
import {
  connectionDefaults,
  connectionSchemaFor,
  type ConnectionValues,
} from "../lib/integration-form";
import styles from "./marketplace-integration.module.css";
import { isFreshMarketplaceSync } from "../lib/connection-state";

export function ConnectionCard({
  connection,
  pending,
  onSave,
  onSync,
  onToggle,
}: {
  connection: MarketplaceConnectionDto;
  pending: boolean;
  onSave: (values: ConnectionValues) => Promise<boolean>;
  onSync: () => Promise<boolean>;
  onToggle: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fieldId = useId();
  const form = useForm<ConnectionValues>({
    resolver: zodResolver(connectionSchemaFor(connection.provider)),
    defaultValues: connectionDefaults,
  });
  const freshRunning = isFreshMarketplaceSync(connection);
  const expiredRunning = connection.syncStatus === "running" && !freshRunning;
  const busy = pending || freshRunning;
  return (
    <article className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeading}>
        <h2>{providerName(connection.provider)}</h2>
        <Badge
          tone={
            !connection.configured || !connection.enabled
              ? "neutral"
              : freshRunning
                ? "warning"
                : connection.syncStatus === "success"
                  ? "success"
                  : "warning"
          }
        >
          {!connection.configured || !connection.enabled
            ? "Не подключён"
            : freshRunning
              ? "Обновляется"
              : connection.syncStatus === "success"
                ? "Подключён"
                : "Нужно обновить"}
        </Badge>
      </div>
      <p className={styles.freshness}>
        {connection.lastSuccessAt
          ? `Данные на ${marketplaceDate(connection.lastSuccessAt)}`
          : "Данные ещё не загружены"}
      </p>
      {connection.enabled &&
        !freshRunning &&
        (expiredRunning ? (
          <p className={styles.warning} role="status">
            Обновление задерживается. Повторим автоматически.
          </p>
        ) : connection.syncStatus === "failed" ||
          connection.syncStatus === "partial" ? (
          <p className={styles.warning} role="status">
            Не удалось обновить данные. Повторим автоматически.
          </p>
        ) : connection.configured && !connection.lastSuccessAt ? (
          <p>Подключение ещё не проверено. Ожидаем обновление.</p>
        ) : null)}
      <div className={styles.actions}>
        {!connection.configured && (
          <Button
            disabled={busy}
            onClick={() => {
              setSettingsOpen(true);
              setEditing(true);
            }}
          >
            Подключить
          </Button>
        )}
      </div>
      <details
        className={styles.connectionSettings}
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>Настройки подключения</summary>
        {connection.configured && (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={busy || !connection.enabled}
              onClick={() => void onSync()}
              aria-busy={freshRunning}
            >
              <RefreshCw size={15} />
              Обновить сейчас
            </Button>
          </div>
        )}
        {connection.configured && (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (editing) form.reset(connectionDefaults);
                setEditing(!editing);
              }}
              aria-expanded={editing}
            >
              {editing ? "Закрыть настройку ключа" : "Заменить ключ"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void onToggle()}
            >
              {connection.enabled ? "Отключить" : "Включить"}
            </Button>
          </div>
        )}
        {(editing || !connection.configured) && (
          <form
            className={styles.form}
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              if (busy) return;
              if (await onSave(values)) {
                form.reset(connectionDefaults);
                setEditing(false);
              }
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
                  <span className={styles.error} id={`${fieldId}-client-error`}>
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
                ? "Персональный токен с доступом только на чтение: «Контент», «Статистика», «Аналитика» и «Поставки»."
                : "Client ID и отдельный ключ только на чтение каталога, данных FBO и аналитики остатков."}{" "}
              Ключ не показывается повторно.
            </p>
            <div className={styles.actions}>
              <Button type="submit" disabled={busy}>
                Сохранить ключ
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  form.reset(connectionDefaults);
                  setEditing(false);
                }}
              >
                Отмена
              </Button>
            </div>
          </form>
        )}
      </details>
    </article>
  );
}
