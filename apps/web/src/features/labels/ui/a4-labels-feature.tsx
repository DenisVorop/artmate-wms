"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Printer, RefreshCw, Scissors } from "lucide-react";
import { useSession, sessionScope } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  rollPaperClass,
} from "@/shared/ui";
import { a4LabelItems, a4Sheets, type A4LabelType } from "../lib/a4-labels";
import { useA4Labels } from "../model/use-a4-labels";
import { useA4Print } from "../lib/use-a4-print";
import styles from "./a4-labels.module.css";

type Props = { type?: A4LabelType; id?: string };
export function A4LabelsFeature(props: Props) {
  const workspace = useWorkspace();
  const session = useSession();
  if (!session.isManager)
    return (
      <ErrorState message="Печать табличек доступна руководителю склада." />
    );
  if (workspace.isPending)
    return <LoadingState label="Загружаем зоны и места…" />;
  if (!workspace.data)
    return (
      <ErrorState
        message="Не удалось загрузить склад"
        onRetry={() => void workspace.refetch()}
      />
    );
  return (
    <A4LabelsEditor
      key={sessionScope(session.user)}
      {...props}
      scope={sessionScope(session.user)}
      data={workspace.data}
      unavailable={workspace.isError || session.isError}
      refresh={() => void workspace.refetch()}
    />
  );
}

function A4LabelsEditor({
  data,
  scope,
  type,
  id,
  unavailable,
  refresh,
}: Props & {
  data: WorkspaceDto;
  scope: string;
  unavailable: boolean;
  refresh: () => void;
}) {
  const items = useMemo(() => a4LabelItems(data), [data]);
  const [selected, setSelected] = useState<string[]>(() =>
    type && id ? [`${type}:${id}`] : items.map((item) => item.key),
  );
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<"all" | A4LabelType>("all");
  const selectedItems = useMemo(
    () => items.filter((item) => selected.includes(item.key)),
    [items, selected],
  );
  const missing = selected.filter(
    (key) => !items.some((item) => item.key === key),
  );
  const visible = items.filter(
    (item) =>
      (category === "all" || item.type === category) &&
      `${item.code} ${item.title}`
        .toLocaleLowerCase("ru")
        .includes(filter.toLocaleLowerCase("ru")),
  );
  const labels = useA4Labels(
    scope,
    selectedItems,
    !unavailable && missing.length === 0,
  );
  const batch = labels.data ?? [];
  const print = useA4Print(batch);
  const ready =
    !unavailable &&
    !missing.length &&
    !labels.isFetching &&
    !labels.isError &&
    selected.length > 0 &&
    batch.length === selected.length &&
    print.ready;
  const roll = print.output === "75x120";
  const sheets = roll ? batch.map((item) => [item]) : a4Sheets(batch);
  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
  }
  return (
    <div
      className={styles.page}
      data-print-ready={ready}
      data-output={print.output}
    >
      <header className={`${styles.header} ${styles.screenOnly}`}>
        <div>
          <Link href="/warehouse" className={styles.back}>
            <ArrowLeft size={16} />К карте склада
          </Link>
          <p className="eyebrow">МАРКИРОВКА СКЛАДА</p>
          <h1 className="page-heading">Таблички склада</h1>
          <p className="page-description">
            Выберите зоны и места. Печатайте на рулоне Xprinter 75 × 120 мм или
            по четыре таблички на листе А4.
          </p>
        </div>
        <Button
          onClick={() => {
            if (ready) window.print();
          }}
          disabled={!ready}
        >
          <Printer size={17} />
          {roll ? "Распечатать этикетки" : "Распечатать А4"}
        </Button>
      </header>
      <div className={styles.workspace}>
        <aside
          className={`glass-panel ${styles.selection} ${styles.screenOnly}`}
          aria-label="Выбор табличек"
        >
          <div className={styles.selectionHeading}>
            <h2>Зоны и места</h2>
            <span>{selected.length} выбрано</span>
          </div>
          <label className="field">
            Формат печати
            <select
              className="input"
              value={print.output}
              onChange={(event) =>
                print.setOutput(event.target.value as "a4" | "75x120")
              }
            >
              <option value="a4">А4 · 4 таблички на листе</option>
              <option value="75x120">Xprinter · 75 × 120 мм</option>
            </select>
          </label>
          <label className="field">
            Показать
            <select
              className="input"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as typeof category)
              }
            >
              <option value="all">Зоны и места</option>
              <option value="work-zone">Только рабочие зоны</option>
              <option value="location">Только места</option>
            </select>
          </label>
          <label className="field">
            Найти
            <input
              className="input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Название или адрес"
              type="search"
            />
          </label>
          <div className={styles.selectionActions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!visible.length}
              onClick={() =>
                setSelected((current) => [
                  ...new Set([...current, ...visible.map((item) => item.key)]),
                ])
              }
            >
              Выбрать показанные
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!selected.length}
              onClick={() => setSelected([])}
            >
              Снять всё
            </Button>
          </div>
          <p className={styles.filterHint}>
            Поиск фильтрует список. В печать идут все выбранные таблички.
          </p>
          <div className={styles.options}>
            {visible.map((item) => (
              <label className={styles.option} key={item.key}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.key)}
                  onChange={() => toggle(item.key)}
                />
                <span>
                  <small>{item.category}</small>
                  <strong>{item.code}</strong>
                  <span>{item.title}</span>
                </span>
              </label>
            ))}
            {!visible.length && (
              <p className={styles.hint}>По этому фильтру ничего нет.</p>
            )}
          </div>
        </aside>
        <section className={styles.preview} aria-label="Предпросмотр печати">
          <div className={`${styles.instructions} ${styles.screenOnly}`}>
            <Scissors size={18} />
            <p>
              <strong>
                {roll
                  ? "75 × 120 мм · одна этикетка · масштаб 100%"
                  : "А4 · книжная ориентация · масштаб 100%"}
              </strong>
              <span>
                {roll
                  ? "В драйвере выберите бумагу 75 × 120 мм, без полей и колонтитулов."
                  : "Отключите колонтитулы браузера. Пунктир — линия вырезания."}
              </span>
            </p>
            <span className={styles.pageCount}>
              {roll
                ? `${selected.length} этик.`
                : `${Math.ceil(selected.length / 4)} лист.`}
            </span>
          </div>
          {unavailable && (
            <div
              role="alert"
              className={`${styles.error} ${styles.screenOnly}`}
            >
              Не удалось обновить склад или проверить доступ. Перед печатью
              восстановите соединение.
              <Button variant="secondary" onClick={refresh}>
                Обновить список
              </Button>
            </div>
          )}
          {missing.length > 0 && (
            <div
              role="alert"
              className={`${styles.error} ${styles.screenOnly}`}
            >
              Выбранных табличек больше нет в активном складе: {missing.length}.
              Проверьте выбор перед печатью.
              <Button
                variant="secondary"
                onClick={() =>
                  setSelected(selectedItems.map((item) => item.key))
                }
              >
                Убрать недоступные
              </Button>
            </div>
          )}
          {labels.isError && (
            <div
              role="alert"
              className={`${styles.error} ${styles.screenOnly}`}
            >
              <p>
                {labels.error instanceof Error
                  ? labels.error.message
                  : "Не удалось загрузить QR."}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  refresh();
                  void labels.refetch();
                }}
              >
                <RefreshCw size={15} />
                Повторить загрузку
              </Button>
            </div>
          )}
          {print.failed && (
            <div
              role="alert"
              className={`${styles.error} ${styles.screenOnly}`}
            >
              Один из QR не отобразился. Печать всего комплекта приостановлена.
              <Button variant="secondary" onClick={print.retry}>
                Повторить загрузку QR
              </Button>
            </div>
          )}
          {labels.isFetching && (
            <div className={styles.screenOnly}>
              <LoadingState label="Готовим QR выбранных табличек…" />
            </div>
          )}
          {!selected.length && (
            <div className={styles.screenOnly}>
              <EmptyState
                title="Выберите таблички слева"
                description="Можно напечатать одну зону, несколько адресов или весь склад."
              />
            </div>
          )}
          <p className={styles.printNotice}>
            Печать недоступна. Дождитесь загрузки всех QR и проверьте выбор
            табличек.
          </p>
          <div className={styles.sheets}>
            {sheets.map((sheet, index) => (
              <div
                className={`${styles.sheet} ${roll ? `${styles.rollSheet} ${rollPaperClass("75x120")}` : ""}`}
                key={index}
                aria-label={`Лист ${index + 1} из ${sheets.length}`}
              >
                {sheet.map((item) => {
                  const imageKey = print.key(item);
                  return (
                    <article
                      className={`${styles.card} ${item.label.title.length > 130 || item.label.code.length > 40 ? styles.denseCard : ""}`}
                      key={item.key}
                      aria-label={`${item.category}: ${item.label.code}, ${item.label.title}`}
                    >
                      <p className={styles.kind}>{item.category}</p>
                      <h2
                        className={
                          item.label.title.length > 70 ? styles.longTitle : ""
                        }
                      >
                        {item.label.title}
                      </h2>
                      {/* Server QR is embedded as an image; SVG cannot execute in this document. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={imageKey}
                        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.label.svg)}`}
                        width={200}
                        height={200}
                        alt={`QR ${item.label.code}`}
                        onLoad={() => print.loaded(imageKey)}
                        onError={() => print.fail(imageKey)}
                      />
                      <strong
                        className={`${styles.code} ${item.label.code.length > 28 ? styles.longCode : ""}`}
                      >
                        {item.label.code}
                      </strong>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
