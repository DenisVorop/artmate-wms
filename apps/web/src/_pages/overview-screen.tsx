"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  ClipboardList,
  Grid2X2,
  Layers3,
  PackageCheck,
  UsersRound,
} from "lucide-react";
import {
  buildWorkQueue,
  filterWorkQueue,
  useWorkQueueStocktakes,
} from "@/entities/work-queue";
import { useWorkspace } from "@/entities/workspace";
import { isAccountedBox } from "@/features/inventory";
import { storageOccupancy } from "@/features/warehouse-layout";
import { number } from "@/shared/lib/format";
import { ErrorState, LoadingState } from "@/shared/ui";
import styles from "./overview-screen.module.css";

export function OverviewScreen() {
  const workspace = useWorkspace();
  const stocktakes = useWorkQueueStocktakes();
  const data = workspace.data;
  if (workspace.isPending) return <LoadingState />;
  if (!data) return <ErrorState onRetry={() => void workspace.refetch()} />;

  const { occupied, total } = storageOccupancy(data);
  const openJobs = stocktakes.data
    ? filterWorkQueue(buildWorkQueue(data, [], { manager: true })).length +
      stocktakes.total
    : null;
  const cards = [
    {
      title: "Товар до упаковки",
      value: data.balance.rawUnits,
      unit: "шт.",
      href: "/inventory",
      icon: Layers3,
    },
    {
      title: "Готовые короба",
      value: data.boxes.filter(isAccountedBox).length,
      unit: "кор.",
      href: "/inventory?view=boxes",
      icon: PackageCheck,
    },
    {
      title: "Загруженность склада",
      value: total ? Math.round((occupied / total) * 100) : null,
      unit: "%",
      note: total
        ? `Занято ${number(occupied)} из ${number(total)} мест`
        : "Нет доступных мест хранения",
      href: "/warehouse",
      icon: Grid2X2,
    },
    {
      title: "На смене",
      value: data.employees.filter(
        ({ status }) => status === "working" || status === "break",
      ).length,
      unit: "чел.",
      href: "/team",
      icon: UsersRound,
    },
    {
      title: "Незавершённые задания",
      value: openJobs,
      note: stocktakes.isError
        ? "Не удалось обновить задания"
        : stocktakes.isPending
          ? "Загружаем задания…"
          : undefined,
      href: "/tasks",
      icon: ClipboardList,
    },
  ];

  return (
    <>
      <h1 className="page-heading">Обзор</h1>
      {workspace.isError && (
        <p className={styles.notice} role="status">
          Не удалось обновить данные склада. Показаны последние загруженные
          значения.
        </p>
      )}
      <div className={styles.grid}>
        {cards.map(({ title, value, unit, note, href, icon: Icon }) => (
          <Link className={styles.card} key={href} href={href}>
            <div className={styles.cardHeader}>
              <Icon className={styles.icon} size={19} aria-hidden="true" />
              <ArrowUpRight
                className={styles.arrow}
                size={16}
                aria-hidden="true"
              />
            </div>
            <span className={styles.title}>{title}</span>
            <strong className={styles.value}>
              {value === null ? "—" : number(value)}
              {value !== null && unit && (
                <span className={styles.unit}>{unit}</span>
              )}
            </strong>
            {note && <span className={styles.note}>{note}</span>}
          </Link>
        ))}
      </div>
    </>
  );
}
