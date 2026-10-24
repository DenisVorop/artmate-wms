"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CheckCheck,
  ChevronRight,
  Clock3,
  Grid2X2,
  Layers3,
  Package,
  Plus,
  ScanLine,
  UsersRound,
} from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Badge, EmptyState, ErrorState, LoadingState } from "@/shared/ui";

const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
const taskLabels: Record<string, string> = {
  active: "В работе",
  in_progress: "В работе",
  pending: "В очереди",
  queued: "В очереди",
  completed: "Готово",
  done: "Готово",
  cancelled: "Отменено",
  paused: "На паузе",
};
const taskLabel = (status: string) => taskLabels[status] || status;

export function DashboardFeature() {
  const { data, isPending, isError, refetch } = useWorkspace();
  if (isPending) return <LoadingState />;
  if (isError || !data)
    return (
      <ErrorState
        onRetry={() => {
          void refetch();
        }}
      />
    );
  const balance = data.balance;
  const storedBoxes = data.boxes.filter((box) => box.status === "stored");
  const accountedBoxes = data.boxes.filter((box) =>
    ["stored", "in_transit"].includes(box.status),
  );
  const occupiedIds = new Set([
    ...data.pallets
      .filter(
        (pallet) => pallet.status === "stored" && pallet.locationId !== null,
      )
      .map((pallet) => pallet.locationId),
    ...storedBoxes
      .filter((box) => box.locationId !== null)
      .map((box) => box.locationId),
  ]);
  const reservedIds = new Set([
    ...data.putawayTasks
      .filter((task) => ["claimed", "in_transit"].includes(task.status))
      .map((task) => task.toLocationId),
    ...data.pallets
      .filter((p) => p.status !== "retired" && p.returnLocationId !== null)
      .map((p) => p.returnLocationId),
    ...data.movements
      .filter((m) => ["planned", "in_transit"].includes(m.status))
      .map((m) => m.toLocationId),
  ]);
  const storageLocations = data.locations.filter(
    (location) =>
      !location.archived && ["rack", "floor"].includes(String(location.kind)),
  );
  const locations = storageLocations.filter((location) => !location.blocked);
  const occupied = locations.filter((location) =>
    occupiedIds.has(location.id),
  ).length;
  const reservedCount = locations.filter(
    (l) => !occupiedIds.has(l.id) && reservedIds.has(l.id),
  ).length;
  const occupancy = locations.length
    ? Math.round((occupied / locations.length) * 100)
    : 0;
  const activeTasks = data.tasks.filter(
    (task) => !["completed", "done", "cancelled"].includes(String(task.status)),
  );
  const employees = data.employees.filter(
    (employee) =>
      !["off_shift", "offline", "off"].includes(String(employee.status)),
  );
  const assembled = data.employees.reduce(
    (sum, employee) => sum + employee.boxesToday,
    0,
  );
  const pendingShipments = data.shipments.filter(
    (shipment) =>
      !["shipped", "completed", "cancelled"].includes(String(shipment.status)),
  );
  const date = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date());
  const latestActivities = [...data.activities]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  return (
    <div className="dashboard page-enter">
      <div className="page-header">
        <div>
          <div className="eyebrow">
            <span className="status-dot" />
            ОПЕРАЦИОННЫЙ ЦЕНТР
          </div>
          <h1 className="page-heading">
            Всё под контролем<span className="heading-dot">.</span>
          </h1>
          <p className="page-description">
            Склад, люди и движение товара — в одном месте.
          </p>
        </div>
        <div className="page-header-actions">
          <span className="dashboard-date">{date}</span>
          <Link href="/receiving" className="button button--primary">
            <Plus size={17} />
            Новая поставка
          </Link>
        </div>
      </div>
      <section className="metrics-grid" aria-label="Основные показатели">
        <div className="metric-card glass-panel">
          <div className="metric-top">
            <span>На балансе</span>
            <span className="metric-icon">
              <Layers3 size={18} />
            </span>
          </div>
          <div className="metric-value">
            {number(balance.totalUnits)}
            <span>шт.</span>
          </div>
          <div className="metric-bottom">
            <span className="metric-indicator" />
            <span>
              До сборки {number(balance.rawUnits)} · в работе{" "}
              {number(balance.workInProgressUnits)}
            </span>
            <Link href="/inventory" aria-label="Открыть остатки раскрасок">
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <div className="metric-card glass-panel">
          <div className="metric-top">
            <span>В коробах на балансе</span>
            <span className="metric-icon">
              <Package size={18} />
            </span>
          </div>
          <div className="metric-value">
            {number(accountedBoxes.length)}
            <span>кор.</span>
          </div>
          <div className="metric-bottom">
            <span> {number(balance.boxedUnits)} раскрасок упаковано</span>
            <Link href="/inventory" aria-label="Открыть готовые короба">
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <div className="metric-card glass-panel metric-card--accent">
          <div className="metric-top">
            <span>Собрано командой</span>
            <span className="metric-icon">
              <CheckCheck size={18} />
            </span>
          </div>
          <div className="metric-value">
            {number(assembled)}
            <span>кор.</span>
          </div>
          <div className="metric-bottom">
            <span className="metric-indicator" />
            <span>За всё время работы демосклада</span>
            <Link href="/assembly" aria-label="Открыть задания сборки">
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <div className="metric-card glass-panel">
          <div className="metric-top">
            <span>Загрузка склада</span>
            <span className="metric-icon">
              <Grid2X2 size={18} />
            </span>
          </div>
          <div className="metric-value">
            {occupancy}
            <span>%</span>
          </div>
          <div className="metric-bottom">
            <span>
              {occupied} из {locations.length} доступных мест занято
            </span>
            <Link href="/warehouse" aria-label="Открыть карту склада">
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="metric-progress">
            <span style={{ width: `${occupancy}%` }} />
          </div>
        </div>
      </section>
      <div className="dashboard-primary-grid">
        <section className="warehouse-overview glass-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">ПРОСТРАНСТВО</p>
              <h2>Карта склада</h2>
            </div>
            <Link href="/warehouse" className="text-link">
              Открыть карту <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="mini-warehouse">
            <div className="mini-warehouse-top">
              <span>
                <Grid2X2 size={14} />
                {data.warehouse.name}
              </span>
              <span className="map-view-label">ЯЧЕЙКИ · ВИД СВЕРХУ</span>
            </div>
            <div className="warehouse-location-grid">
              {storageLocations.slice(0, 18).map((location) => {
                const used = occupiedIds.has(location.id);
                const reserved = reservedIds.has(location.id) && !used;
                const palletCount = data.pallets.filter(
                  (pallet) =>
                    pallet.locationId === location.id &&
                    pallet.status === "stored",
                ).length;
                return (
                  <Link
                    href="/warehouse"
                    key={location.id}
                    className={`mini-location ${location.blocked ? "mini-location--blocked" : used ? "mini-location--occupied" : reserved ? "mini-location--reserved" : ""}`}
                    aria-label={`${location.code}, ${location.blocked ? "заблокировано" : used ? "занято" : reserved ? "зарезервировано" : "свободно"}`}
                  >
                    <span className="mini-location-code">
                      {location.code}
                      <span className="mini-location-light" />
                    </span>
                    <div className="mini-pallets">
                      {Array.from(
                        {
                          length: Math.min(
                            Math.max(palletCount, used ? 1 : 0),
                            4,
                          ),
                        },
                        (_, index) => (
                          <span key={index}>
                            <i />
                            <i />
                            <i />
                          </span>
                        ),
                      )}
                    </div>
                    <small>
                      {location.blocked
                        ? "Недоступно"
                        : used
                          ? "Занято"
                          : reserved
                            ? "Резерв"
                            : "Свободно"}
                    </small>
                  </Link>
                );
              })}
            </div>
            {storageLocations.length === 0 && (
              <EmptyState
                title="Склад начинается с карты"
                description="Создайте первое место хранения"
                action={
                  <Link href="/warehouse" className="button button--secondary">
                    Создать место
                  </Link>
                }
              />
            )}
            <div className="mini-warehouse-aisle">
              <span />
              ПРОХОД
              <span />
            </div>
          </div>
          <div className="map-legend">
            <span>
              <i className="legend-dot legend-dot--occupied" />
              Занято · {occupied}
            </span>
            <span>
              <i className="legend-dot" />
              Свободно · {locations.length - occupied - reservedCount}
            </span>
            <span>
              <i className="legend-dot legend-dot--blocked" />
              Недоступно · {storageLocations.length - locations.length}
            </span>
            <span>
              <i className="legend-dot legend-dot--reserved" />
              Резерв · {reservedCount}
            </span>
            <Link href="/warehouse" aria-label="Настроить склад">
              <ChevronRight size={16} />
            </Link>
          </div>
        </section>
        <section className="operations-panel glass-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">СЕЙЧАС НА СКЛАДЕ</p>
              <h2>Пульс операций</h2>
            </div>
            <span className="live-chip">
              <span className="status-dot" />
              LIVE
            </span>
          </div>
          <div className="operation-summary">
            <Link href="/assembly">
              <span className="operation-icon">
                <Boxes size={21} />
              </span>
              <span>
                <strong>Сборка коробов</strong>
                <small>Активные задания и очередь</small>
              </span>
              <b>{activeTasks.length}</b>
              <ChevronRight size={16} />
            </Link>
            <Link href="/shipments">
              <span className="operation-icon">
                <ArrowUpRight size={21} />
              </span>
              <span>
                <strong>Ожидают отгрузки</strong>
                <small>Подготовка и комплектация</small>
              </span>
              <b>{pendingShipments.length}</b>
              <ChevronRight size={16} />
            </Link>
            <Link href="/team">
              <span className="operation-icon">
                <UsersRound size={21} />
              </span>
              <span>
                <strong>Команда на смене</strong>
                <small>Сборка и перемещения</small>
              </span>
              <b>{employees.length}</b>
              <ChevronRight size={16} />
            </Link>
          </div>
          <div className="fifo-note">
            <div className="fifo-note-symbol">
              <ScanLine size={23} />
            </div>
            <div>
              <strong>Каждому коробу — своя история</strong>
              <p>
                FIFO по дате поступления. Партии сохраняются даже в смешанном
                коробе.
              </p>
            </div>
            <span className="fifo-badge">FIFO</span>
          </div>
          <Link
            href="/assembly"
            className="button button--secondary full-width"
          >
            Перейти к сборке
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      <div className="dashboard-secondary-grid">
        <section className="glass-panel dashboard-tasks">
          <div className="panel-header">
            <div>
              <p className="eyebrow">ПРОИЗВОДИТЕЛЬНОСТЬ</p>
              <h2>Задания на сборку</h2>
            </div>
            <Link href="/assembly" className="text-link">
              Все задания <ArrowUpRight size={16} />
            </Link>
          </div>
          {activeTasks.length > 0 ? (
            <div className="task-list">
              {activeTasks.slice(0, 4).map((task) => {
                const sku = data.skus.find((item) => item.id === task.skuId);
                const employee = data.employees.find(
                  (item) => item.id === task.employeeId,
                );
                const percentage = task.boxesTarget
                  ? Math.round((task.boxesCompleted / task.boxesTarget) * 100)
                  : 0;
                return (
                  <Link
                    href="/assembly"
                    className="dashboard-task"
                    key={task.id}
                  >
                    <span className="task-product-icon">
                      <Boxes size={20} />
                    </span>
                    <div className="task-info">
                      <strong>{sku?.name || "Товар"}</strong>
                      <small>
                        {task.code} <span>·</span>{" "}
                        {employee?.name || "Ожидает сотрудника"}
                      </small>
                    </div>
                    <div className="task-completion">
                      <span>
                        {task.boxesCompleted}
                        <small> / {task.boxesTarget} кор.</small>
                      </span>
                      <div className="progress-track">
                        <span style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                    <Badge
                      tone={
                        ["active", "in_progress"].includes(String(task.status))
                          ? "success"
                          : "neutral"
                      }
                    >
                      {taskLabel(String(task.status))}
                    </Badge>
                    <ChevronRight size={16} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Все задания выполнены"
              description="Создайте задание, чтобы пополнить запас готовых коробов."
              action={
                <Link className="button button--secondary" href="/assembly">
                  <Plus size={16} />
                  Создать задание
                </Link>
              }
            />
          )}
        </section>
        <section className="glass-panel activity-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">ДВИЖЕНИЕ ТОВАРА</p>
              <h2>Последние события</h2>
            </div>
            <Clock3 size={18} className="muted" />
          </div>
          <div className="activity-list">
            {latestActivities.map((activity) => (
              <div className="activity-item" key={activity.id}>
                <span className="activity-icon">
                  {activity.kind === "receiving" ? (
                    <ArrowDownToLine size={15} />
                  ) : activity.kind === "shipment" ? (
                    <ArrowUpRight size={15} />
                  ) : (
                    <Package size={15} />
                  )}
                </span>
                <div>
                  <strong>{activity.title}</strong>
                  <p>{activity.description}</p>
                </div>
                <time dateTime={activity.createdAt}>
                  {time(activity.createdAt)}
                </time>
              </div>
            ))}
            {latestActivities.length === 0 && (
              <EmptyState
                title="История пока пуста"
                description="Здесь появятся приёмки, сборки и перемещения."
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
