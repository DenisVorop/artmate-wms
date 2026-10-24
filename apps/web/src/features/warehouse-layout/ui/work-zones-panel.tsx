"use client";
import Link from "next/link";
import { ArchiveRestore, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import type { WorkZoneDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
import { workZoneKindLabels } from "../lib/work-zone-form";
import styles from "./work-zones.module.css";
export function WorkZonesPanel({
  data,
  selectedId,
  pending,
  error,
  onSelect,
  onCreate,
  onEdit,
  onArchive,
  onRestore,
}: {
  data: WorkspaceDto;
  selectedId: string | null;
  pending: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onArchive: (id: string) => Promise<unknown>;
  onRestore: (id: string) => Promise<unknown>;
}) {
  const zones = data.warehouse.workZones;
  function card(zone: WorkZoneDto) {
    return (
      <article
        key={zone.id}
        className={`${styles.card} ${selectedId === zone.id && !zone.archived ? styles.selected : ""}`}
      >
        <button
          type="button"
          className={styles.select}
          disabled={zone.archived}
          aria-pressed={selectedId === zone.id && !zone.archived}
          onClick={() => onSelect(zone.id)}
        >
          <span>
            {workZoneKindLabels[zone.kind]} · {zone.code}
          </span>
          <strong>{zone.name}</strong>
        </button>
        <ul className={styles.members} aria-label={`Адреса зоны ${zone.name}`}>
          {zone.locationIds.map((id) => (
            <li key={id}>
              {data.locations.find((l) => l.id === id)?.code ??
                "Адрес недоступен"}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          {zone.archived ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => void onRestore(zone.id).catch(() => {})}
            >
              <ArchiveRestore size={14} />
              Восстановить {zone.code}
            </Button>
          ) : (
            <>
              <Link
                href={`/labels/a4?type=work-zone&id=${encodeURIComponent(zone.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="button button--secondary button--sm"
              >
                <QrCode size={14} />
                Табличка А4
              </Link>
              <Link
                href={`/labels/work-zone/${encodeURIComponent(zone.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="button button--secondary button--sm"
              >
                <QrCode size={14} />
                QR зоны {zone.code}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => onEdit(zone.id)}
                aria-label={`Настроить рабочую зону ${zone.name}`}
              >
                <Pencil size={14} />
                Настроить
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => void onArchive(zone.id).catch(() => {})}
                aria-label={`Убрать рабочую зону ${zone.name} в корзину`}
              >
                <Trash2 size={14} />В корзину
              </Button>
            </>
          )}
        </div>
      </article>
    );
  }
  return (
    <section
      className={`glass-panel ${styles.panel}`}
      aria-label="Рабочие зоны"
    >
      <div className={styles.heading}>
        <div>
          <h2>Рабочие зоны</h2>
          <p>
            Объедините адреса по назначению и распечатайте QR для начала работы.
            Зоны не меняют вместимость и остатки.
          </p>
        </div>
        <Button disabled={pending} onClick={onCreate}>
          <Plus size={16} />
          Создать рабочую зону
        </Button>
      </div>
      {zones.some((z) => !z.archived) ? (
        <div className={styles.list}>
          {zones.filter((z) => !z.archived).map(card)}
        </div>
      ) : (
        <p className={styles.description}>
          Рабочих зон пока нет. Создайте зону и выберите её существующие адреса.
        </p>
      )}
      {selectedId && zones.some((z) => z.id === selectedId && !z.archived) && (
        <p className={styles.hint}>
          Адреса выбранной зоны выделены пунктиром на карте. Выделение места и
          его остатки доступны как обычно.
        </p>
      )}
      <details className={styles.trash}>
        <summary>
          Корзина рабочих зон · {zones.filter((z) => z.archived).length}
        </summary>
        {zones.some((z) => z.archived) ? (
          <div className={styles.list}>
            {zones.filter((z) => z.archived).map(card)}
          </div>
        ) : (
          <p className={styles.description}>В корзине нет рабочих зон.</p>
        )}
      </details>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
