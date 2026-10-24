"use client";
import { Grid2X2, Pencil, Route, Trash2, Scaling } from "lucide-react";
import type {
  WarehouseSpaceDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
import { spaceArchiveReasons, spaceKindLabels } from "../lib/space-form";
import styles from "./plan-panels.module.css";

type Props = {
  data: WorkspaceDto;
  space: WarehouseSpaceDto;
  editing?: boolean;
  pending: boolean;
  error: string | null;
  onEdit: (id: string) => void;
  onResize: (id: string) => void;
  onArchive: (key: string) => Promise<unknown>;
};
export function SpaceDetails({
  data,
  space,
  editing = true,
  pending,
  error,
  onEdit,
  onResize,
  onArchive,
}: Props) {
  const reasons = spaceArchiveReasons(data, space);
  return (
    <aside
      className={`glass-panel ${styles.panel}`}
      aria-label="Параметры участка"
    >
      <span className={styles.objectIcon}>
        {space.kind === "corridor" ? (
          <Route size={22} />
        ) : (
          <Grid2X2 size={22} />
        )}
      </span>
      <p className="eyebrow">{spaceKindLabels[space.kind].toUpperCase()}</p>
      <h2>{space.name}</h2>
      <p>
        {space.kind === "corridor"
          ? "Участок пола для связи помещений и временного хранения."
          : "Реальное помещение на общем плане склада."}
      </p>
      <div className={styles.facts}>
        <div>
          <span>Размеры</span>
          <strong>
            {space.width} × {space.depth} м
          </strong>
        </div>
        <div>
          <span>Площадь</span>
          <strong>
            {new Intl.NumberFormat("ru-RU", {
              maximumFractionDigits: 4,
            }).format(space.width * space.depth)}{" "}
            м²
          </strong>
        </div>
        <div>
          <span>Положение X / Y</span>
          <strong>
            {space.x} / {space.y} м
          </strong>
        </div>
      </div>
      {editing && (
        <p>
          Перетаскивание переносит участок вместе с целиком расположенными
          внутри стеллажами, местами и проходами. Привязанные входы следуют за
          стенами. Ручки по краям меняют границы без переноса оборудования.
          Точные границы можно задать кнопкой «Изменить размеры».
        </p>
      )}
      {editing && (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onResize(space.id)}
          >
            <Scaling size={15} />
            Изменить размеры
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onEdit(space.id)}
          >
            <Pencil size={15} />
            Настроить участок
          </Button>
          <Button
            variant="danger"
            disabled={pending || reasons.length > 0}
            aria-busy={pending}
            onClick={() => void onArchive(`space:${space.id}`).catch(() => {})}
          >
            <Trash2 size={15} />
            Удалить участок с плана
          </Button>
          {reasons.length ? (
            <ul className={styles.reasonList}>
              {reasons.map((reason) => (
                <li className={styles.reason} key={reason}>
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.reason}>
              Участок останется в корзине. Его можно восстановить позже.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
