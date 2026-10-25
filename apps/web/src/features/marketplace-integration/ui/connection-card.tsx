"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, RefreshCw } from "lucide-react";
import {
  marketplaceDate,
  providerName,
  syncLabel,
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
        <div>
          <h2>{providerName(connection.provider)}</h2>
          <small>
            {connection.provider === "wildberries" ? "FBW" : "FBO"} · склады
            маркетплейса
          </small>
        </div>
        <Badge
          tone={
            !connection.enabled
              ? "neutral"
              : connection.syncStatus === "success"
                ? "success"
                : connection.syncStatus === "failed"
                  ? "danger"
                  : "warning"
          }
        >
          {!connection.configured
            ? "Не подключено"
            : !connection.enabled
              ? "Отключено"
              : expiredRunning
                ? "Загрузка прервана"
                : syncLabel(connection.syncStatus)}
        </Badge>
      </div>
      <div className={styles.facts}>
        <div>
          <span>Последняя успешная загрузка</span>
          <strong>{marketplaceDate(connection.lastSuccessAt)}</strong>
        </div>
        <div>
          <span>Последняя попытка</span>
          <strong>{marketplaceDate(connection.lastAttemptAt)}</strong>
        </div>
      </div>
      {connection.message &&
        connection.message !== syncLabel(connection.syncStatus) && (
          <p
            className={
              connection.syncStatus === "failed" ? styles.error : styles.warning
            }
          >
            {connection.message}
          </p>
        )}
      {connection.warnings.map((warning) => (
        <p className={styles.warning} key={warning}>
          {warning}
        </p>
      ))}
      {expiredRunning && (
        <p className={styles.warning}>
          Предыдущая загрузка не завершилась. Можно повторить попытку.
        </p>
      )}
      {connection.configured && !connection.lastSuccessAt && (
        <p>Ключ сохранён. Подключение проверяется при загрузке данных.</p>
      )}
      <div className={styles.actions}>
        <Button
          variant={connection.configured ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => {
            if (editing) form.reset(connectionDefaults);
            setEditing(!editing);
          }}
          aria-expanded={editing}
        >
          <KeyRound size={15} />
          {editing
            ? "Закрыть настройку"
            : connection.configured
              ? "Заменить ключ"
              : "Подключить"}
        </Button>
        {connection.configured && (
          <Button
            disabled={busy || !connection.enabled}
            onClick={() => void onSync()}
            aria-busy={busy}
          >
            <RefreshCw size={15} />
            Загрузить данные
          </Button>
        )}
        {connection.configured && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void onToggle()}
          >
            {connection.enabled ? "Отключить" : "Включить"}
          </Button>
        )}
      </div>
      {editing && (
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
              ? "Персональный токен с доступом только на чтение: «Контент», «Статистика» и «Аналитика»."
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
    </article>
  );
}
