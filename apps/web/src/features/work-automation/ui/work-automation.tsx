"use client";
import Link from "next/link";
import { useSession } from "@/entities/session";
import { useWorkAutomation } from "@/entities/work-automation";
import { Button } from "@/shared/ui";
import { useWorkAutomationSettings } from "../model/use-work-automation-settings";
import styles from "./work-automation.module.css";

export function WorkAutomation() {
  const session = useSession(),
    query = useWorkAutomation(session.isManager);
  const settings = useWorkAutomationSettings();
  if (!session.isManager) return null;
  const status = query.data;
  const urgent = status && ["near_full", "full"].includes(status.pressure);
  const blockers =
    status?.blockers.filter((reason) => reason !== status.message) ?? [];
  return (
    <section
      className={`glass-panel ${styles.panel}`}
      aria-labelledby="work-automation-title"
    >
      <div className={styles.heading}>
        <div>
          <h2 id="work-automation-title">Автоматические задания</h2>
          <p>Сборка по потребности склада и размещение готовых коробов.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Автоматические задания"
          aria-checked={status?.enabled ?? false}
          disabled={!status || settings.pending || query.isError}
          aria-busy={settings.pending}
          className={styles.toggle}
          onClick={() => status && void settings.save(!status.enabled)}
        >
          <span aria-hidden="true" />
          <span>
            {status?.enabled ? "Включены" : status ? "Выключены" : "Проверяем…"}
          </span>
        </button>
      </div>
      {status ? (
        <>
          <p className={styles.message} role="status">
            {status.message}
          </p>
          <p className={styles.counts}>
            В очереди: сборка — {status.queuedAssemblyTasks}, размещение —{" "}
            {status.queuedPutawayTasks}.
          </p>
          {urgent && (
            <div className={styles.pressure} role="status">
              <strong>
                {status.assemblyBoxes > 0
                  ? "Освободите сборочную паллету"
                  : "Дождитесь свободного места"}
              </strong>
              {status.assemblyBoxes > 0 ? (
                <>
                  <p>
                    Готовых коробов: {status.assemblyBoxes}. Перенесите их на
                    хранение.
                  </p>
                  <Link href="/putaway" className="button button--secondary">
                    Разобрать сборочную паллету
                  </Link>
                </>
              ) : (
                <p>
                  Свободные места заняты текущей сборкой. Готовых коробов для
                  размещения пока нет.
                </p>
              )}
            </div>
          )}
          {blockers.length > 0 && (
            <details className={styles.blockers}>
              <summary>Что мешает создавать задания</summary>
              <ul>
                {blockers.map((reason, index) => (
                  <li key={`${index}:${reason}`}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className={styles.message} role="status">
          {query.isError
            ? "Состояние пока недоступно."
            : "Проверяем автоматические задания…"}
        </p>
      )}
      {settings.error && (
        <p className={styles.error} role="alert">
          {settings.error}
        </p>
      )}
      {query.isError && (
        <div className={styles.error} role="alert">
          Не удалось обновить состояние автоматических заданий.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
    </section>
  );
}
