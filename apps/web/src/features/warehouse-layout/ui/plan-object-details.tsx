"use client";
import {
  DoorOpen,
  MoveHorizontal,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import type {
  AisleDto,
  EntranceDto,
  WarehousePlanDto,
} from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
import { entranceFrame, wallLabels } from "../lib/plan-form";
import styles from "./plan-panels.module.css";

type Props = {
  aisle?: AisleDto;
  entrance?: EntranceDto;
  warehouse: WarehousePlanDto;
  editing?: boolean;
  pending: boolean;
  error: string | null;
  onEdit: (key: string) => void;
  onRotate: (key: string, rotation: number) => Promise<unknown>;
  onArchive: (key: string) => Promise<unknown>;
};
export function PlanObjectDetails({
  aisle,
  entrance,
  warehouse,
  editing = true,
  pending,
  error,
  onEdit,
  onRotate,
  onArchive,
}: Props) {
  const object = aisle ?? entrance;
  if (!object) return null;
  const frame = entrance ? entranceFrame(warehouse, entrance.spaceId) : null;
  const key = `${aisle ? "aisle" : "entrance"}:${object.id}`;
  return (
    <aside
      className={`glass-panel ${styles.panel}`}
      aria-label={aisle ? "Параметры прохода" : "Параметры входа"}
    >
      <span className={styles.objectIcon}>
        {aisle ? <MoveHorizontal size={22} /> : <DoorOpen size={22} />}
      </span>
      <p className={styles.objectType}>{aisle ? "Проход" : "Вход"}</p>
      <h2>{object.name}</h2>
      <div className={styles.facts}>
        {aisle ? (
          <>
            <div>
              <span>Размеры</span>
              <strong>
                {aisle.width} × {aisle.depth} м
              </strong>
            </div>
            <div>
              <span>Положение X / Y</span>
              <strong>
                {aisle.x} / {aisle.y} м
              </strong>
            </div>
            <div>
              <span>Поворот</span>
              <strong>{aisle.rotation}°</strong>
            </div>
          </>
        ) : (
          entrance && (
            <>
              <div>
                <span>Участок</span>
                <strong>{frame?.name ?? "Участок недоступен"}</strong>
              </div>
              <div>
                <span>Стена</span>
                <strong>{wallLabels[entrance.wall]}</strong>
              </div>
              <div>
                <span>Отступ от края</span>
                <strong>{entrance.offset} м</strong>
              </div>
              <div>
                <span>Ширина проёма</span>
                <strong>{entrance.width} м</strong>
              </div>
              <div>
                <span>Длина стены</span>
                <strong>
                  {frame
                    ? ["north", "south"].includes(entrance.wall)
                      ? frame.width
                      : frame.depth
                    : "—"}{" "}
                  м
                </strong>
              </div>
            </>
          )
        )}
      </div>
      {editing && (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onEdit(key)}
          >
            <Pencil size={15} />
            {aisle ? "Настроить проход" : "Настроить вход"}
          </Button>
          {aisle && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void onRotate(key, (aisle.rotation + 90) % 360).catch(() => {})
              }
            >
              <RotateCw size={15} />
              Повернуть проход на 90°
            </Button>
          )}
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => void onArchive(key).catch(() => {})}
          >
            <Trash2 size={15} />
            {aisle ? "Удалить проход с плана" : "Удалить вход с плана"}
          </Button>
          <p className={styles.reason}>
            Объект останется в корзине. Его можно восстановить.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </aside>
  );
}
