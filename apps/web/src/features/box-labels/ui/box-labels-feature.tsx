"use client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Plus,
  Printer,
  RefreshCw,
} from "lucide-react";
import { sessionScope, useSession } from "@/entities/session";
import { useBoxLabelBatches, useFreeBoxLabels } from "@/entities/box-labels";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  RollLabelFormatSelect,
  Select,
  rollPaperClass,
  StockLabel,
} from "@/shared/ui";
import {
  boxLabelBatchSchema,
  completeFreeLabelPage,
  type BoxLabelBatchValues,
} from "../lib/box-labels";
import { useBoxLabelState } from "../lib/use-box-label-state";
import { useCreateLabelBatch } from "../model/use-create-label-batch";
import { boxLabelFormats, rollLabelFormats } from "@/shared/lib/label-paper";
import styles from "@/shared/ui/label-reserve.module.css";

export function BoxLabelsFeature() {
  const session = useSession();
  if (!session.isManager)
    return (
      <EmptyState
        title="Этикетки выпускает руководитель"
        description="Готовые этикетки сотрудник получает на месте сборки."
      />
    );
  return (
    <BoxLabelEditor
      key={sessionScope(session.user)}
      scope={sessionScope(session.user)}
      unavailable={session.isError || session.isPending}
    />
  );
}
function BoxLabelEditor({
  scope,
  unavailable,
}: {
  scope: string;
  unavailable: boolean;
}) {
  const ui = useBoxLabelState(scope);
  const create = useCreateLabelBatch();
  const batches = useBoxLabelBatches(scope, ui.historyPage);
  const labels = useFreeBoxLabels(scope, ui.selectedId, ui.page, ui.pageSize);
  const form = useForm<BoxLabelBatchValues>({
    resolver: zodResolver(boxLabelBatchSchema),
    defaultValues: { count: 100 },
  });
  const items = labels.data?.items ?? [];
  const complete = completeFreeLabelPage(
    labels.data,
    ui.selectedId,
    ui.page,
    ui.pageSize,
  );
  const ready =
    !unavailable &&
    !labels.isFetching &&
    !labels.isError &&
    complete &&
    items.every(ui.imageReady);
  const failed = items.some(ui.imageFailed);
  const pages = Math.max(1, Math.ceil((labels.data?.total ?? 0) / ui.pageSize));
  const historyPages = Math.max(1, Math.ceil((batches.data?.total ?? 0) / 10));
  const batch = labels.data?.batch;
  return (
    <div
      className={`${styles.page} ${rollPaperClass(ui.format)}`}
      data-print-ready={ready}
    >
      <header className={`page-header ${styles.screenOnly}`}>
        <div>
          <Link href="/assembly" className={styles.back}>
            <ArrowLeft size={16} />К сборке
          </Link>
          <p className="eyebrow">ЗАПАС ЭТИКЕТОК</p>
          <h1 className="page-heading">Этикетки коробов</h1>
          <p className="page-description">
            Напечатайте заранее. Сборщик наклеит любую свободную этикетку и
            отсканирует её после паллеты.
          </p>
        </div>
        <div className={styles.links}>
          <Link href="/labels/pallets" className="button button--secondary">
            Этикетки паллет
          </Link>
          <Link href="/labels/a4" className="button button--secondary">
            Зоны и места
          </Link>
        </div>
      </header>
      <div className={`${styles.layout} ${styles.screenOnly}`}>
        <aside className={`glass-panel ${styles.panel}`}>
          <h2>Новый комплект</h2>
          <p className={styles.help}>
            Универсальные коды без тематики. Товар появится в коробе только
            после сборки.
          </p>
          <form
            className={styles.form}
            noValidate
            aria-busy={create.pending}
            onSubmit={form.handleSubmit(async (values) => {
              const added = await create.create(values.count);
              if (added) {
                ui.select(added.id);
                ui.setHistoryPage(1);
              }
            })}
          >
            <label className="field">
              Количество этикеток
              <Input
                type="number"
                min={1}
                max={1000}
                step={1}
                {...form.register("count", { valueAsNumber: true })}
                disabled={create.pending || create.unresolved || unavailable}
                aria-invalid={!!form.formState.errors.count}
              />
              {form.formState.errors.count && (
                <span className={styles.error}>
                  {form.formState.errors.count.message}
                </span>
              )}
            </label>
            <Button
              type="submit"
              disabled={create.pending || unavailable}
              aria-busy={create.pending}
            >
              <Plus size={16} />
              {create.unresolved ? "Повторить создание" : "Создать комплект"}
            </Button>
          </form>
          {create.error && (
            <p className={styles.error} role="alert">
              {create.error}
            </p>
          )}
          {create.unresolved && (
            <p className={styles.help}>
              Повторите создание с прежним количеством — уже выпущенные коды не
              продублируются.
            </p>
          )}
          <div className={styles.sectionHeading}>
            <h2>Комплекты</h2>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Обновить комплекты"
              onClick={() => void batches.refetch()}
              disabled={batches.isFetching}
            >
              <RefreshCw size={15} />
            </Button>
          </div>
          {batches.isPending && (
            <p role="status" className={styles.help}>
              Загружаем комплекты…
            </p>
          )}
          {batches.isError && (
            <p className={styles.error} role="alert">
              Не удалось обновить комплекты. Повторите загрузку.
            </p>
          )}
          {!batches.isPending &&
            !batches.isError &&
            !batches.data?.items.length && (
              <p className={styles.help}>Пока нет выпущенных этикеток.</p>
            )}
          <div className={styles.batches}>
            {batches.data?.items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={styles.batch}
                aria-pressed={ui.selectedId === item.id}
                onClick={() => ui.select(item.id)}
              >
                <span className={styles.batchHeading}>
                  <strong>{item.code}</strong>
                  <Badge tone={item.freeCount ? "success" : "neutral"}>
                    {item.freeCount} свободно
                  </Badge>
                </span>
                <span>
                  {new Date(item.createdAt).toLocaleDateString("ru-RU")} · всего{" "}
                  {item.count} · занято {item.assignedCount}
                </span>
              </button>
            ))}
          </div>
          {historyPages > 1 && (
            <div className={styles.pagination}>
              <Button
                size="sm"
                variant="ghost"
                disabled={ui.historyPage <= 1 || batches.isFetching}
                onClick={() => ui.setHistoryPage(ui.historyPage - 1)}
                aria-label="Предыдущие комплекты"
              >
                <ChevronLeft size={16} />
              </Button>
              <span>
                {ui.historyPage} / {historyPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={ui.historyPage >= historyPages || batches.isFetching}
                onClick={() => ui.setHistoryPage(ui.historyPage + 1)}
                aria-label="Следующие комплекты"
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </aside>
        <section
          className={`glass-panel ${styles.panel}`}
          aria-label="Подготовка к печати"
        >
          <h2>{batch?.code ?? "Выберите комплект"}</h2>
          {!ui.selectedId ? (
            <EmptyState
              title="Этикетки для сборки"
              description="Создайте новый комплект или выберите существующий слева."
            />
          ) : (
            <>
              {batch && (
                <div className={styles.metrics}>
                  <div>
                    <strong>{batch.freeCount}</strong>
                    <span>свободных</span>
                  </div>
                  <div>
                    <strong>{batch.assignedCount}</strong>
                    <span>уже закреплено</span>
                  </div>
                  <div>
                    <strong>{items.length}</strong>
                    <span>в этой печати</span>
                  </div>
                </div>
              )}
              <p className={styles.help}>
                Печатаются только свободные коды. Повторная печать сохраняет те
                же коды: используйте один физический экземпляр каждой этикетки.
              </p>
              <div className={styles.controls}>
                <RollLabelFormatSelect
                  formats={boxLabelFormats}
                  value={ui.format}
                  onChange={ui.setFormat}
                />
                <label className="field">
                  Этикеток за раз
                  <Select
                    value={ui.pageSize}
                    onChange={(event) =>
                      ui.changeSize(Number(event.target.value))
                    }
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ui.page <= 1 || labels.isFetching}
                  onClick={() => ui.setPage(ui.page - 1)}
                  aria-label="Предыдущие свободные этикетки"
                >
                  <ChevronLeft size={16} />
                </Button>
                <span>
                  Часть {ui.page} из {pages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={ui.page >= pages || labels.isFetching}
                  onClick={() => ui.setPage(ui.page + 1)}
                  aria-label="Следующие свободные этикетки"
                >
                  <ChevronRight size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void labels.refetch()}
                  disabled={labels.isFetching}
                >
                  <RefreshCw size={15} />
                  Обновить
                </Button>
              </div>
              {labels.isFetching && (
                <p role="status" className={styles.help}>
                  Проверяем свободные этикетки…
                </p>
              )}
              {labels.isError && (
                <p role="alert" className={styles.error}>
                  Не удалось загрузить этикетки. Обновите данные перед печатью.
                </p>
              )}
              {!labels.isFetching && labels.data?.total === 0 && (
                <p className={styles.help}>
                  Все этикетки закреплены за коробами. Создайте новый комплект.
                </p>
              )}
              {!labels.isFetching &&
                !labels.isError &&
                !!labels.data?.total &&
                !complete && (
                  <p role="alert" className={styles.error}>
                    Эта часть недоступна или загружена не полностью. Обновите
                    данные или выберите другую часть.
                  </p>
                )}
              {failed && (
                <p className={styles.error} role="alert">
                  Не все QR загрузились.{" "}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={ui.retryImages}
                  >
                    Повторить загрузку QR
                  </Button>
                </p>
              )}
              <Button
                disabled={!ready}
                onClick={() => {
                  if (ready) window.print();
                }}
              >
                <Printer size={17} />
                Распечатать {ready ? items.length : "этикетки"}
              </Button>
              <p className={styles.help}>
                {rollLabelFormats[ui.format]} · масштаб 100% · без полей и
                колонтитулов. Закрытие окна печати не меняет статус кода.
              </p>
            </>
          )}
        </section>
      </div>
      <p className={`${styles.printNotice} ${rollPaperClass(ui.format)}`}>
        Печать недоступна. Вернитесь в WMS, обновите комплект и дождитесь
        загрузки всех QR.
      </p>
      <div className={styles.labels} aria-label="Предпросмотр этикеток">
        {complete &&
          !unavailable &&
          items.map((item) => {
            const key = ui.key(item);
            return (
              <StockLabel
                kind="box"
                format={ui.format}
                key={key}
                imageKey={key}
                code={item.code}
                svg={item.svg}
                onLoad={() => ui.loaded(key)}
                onError={() => ui.failed(key)}
              />
            );
          })}
      </div>
    </div>
  );
}
