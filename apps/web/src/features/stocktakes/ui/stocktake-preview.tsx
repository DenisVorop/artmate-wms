"use client";
import type {
  StocktakeDto,
  StocktakePreviewDto,
} from "@/shared/api/generated/model";
import { number } from "@/shared/lib/format";
import { stocktakePreviewPresentation } from "../lib/stocktake-view";
import styles from "./stocktakes.module.css";
const changeTitle = (kind: string) =>
  (
    ({
      raw_count: "Количество сырья",
      box_writeoff: "Списание короба",
      raw_pallet_relocation: "Перенос паллеты",
      box_relocation: "Перенос короба",
    }) as Record<string, string>
  )[kind] ?? "Изменение";
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
export function StocktakePreview({
  doc,
  preview,
  applied = false,
}: {
  doc: StocktakeDto;
  preview: StocktakePreviewDto;
  applied?: boolean;
}) {
  const presentation = stocktakePreviewPresentation(doc, preview);
  const address = (id: string | null) =>
    id
      ? (doc.rows.find((row) => row.locationId === id)?.locationCode ??
        "Адрес вне документа")
      : "—";
  return (
    <section
      className={`glass-panel ${styles.review}`}
      aria-label={applied ? "Применённые изменения" : "Проверка расхождений"}
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2>
            {applied ? "Применённые изменения" : "Расхождения и изменения"}
          </h2>
          <p>
            {applied
              ? "Сохранённый результат утверждения. Последующие складские операции его не меняют."
              : presentation.showChanges
                ? "Подсчёт ещё не изменил остатки. Ниже — полный состав предлагаемых изменений."
                : "Подсчёт ещё не завершён. Остатки не изменялись."}
          </p>
        </div>
        {presentation.unitsDelta !== null && (
          <div className={styles.subtle}>
            Изменение остатка:{" "}
            <strong
              className={
                presentation.unitsDelta < 0
                  ? styles.deltaMinus
                  : presentation.unitsDelta > 0
                    ? styles.deltaPlus
                    : undefined
              }
            >
              {signed(presentation.unitsDelta)} шт.
            </strong>
          </div>
        )}
      </div>
      {!applied && !!presentation.issues.length && (
        <div className={styles.error} style={{ margin: "0 20px" }} role="alert">
          <strong>До утверждения нужно разобраться</strong>
          <ul className={styles.blockers}>
            {presentation.issues.map((issue, index) => (
              <li key={`${issue.code}:${index}`}>
                {issue.message}
                {issue.locationIds.length > 0 && (
                  <span> · {issue.locationIds.map(address).join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!presentation.showChanges ? (
        <p className={styles.panel} role="status">
          Расхождения появятся после подсчёта всех ячеек. Сейчас пересчитано{" "}
          {doc.rows.filter((row) => row.count != null).length} из{" "}
          {doc.rows.length}. Непересчитанные ячейки не считаются пустыми.
        </p>
      ) : presentation.changes.length ? (
        <div className={styles.diffs}>
          <table className={styles.diffTable}>
            <caption
              style={{
                textAlign: "left",
                padding: "0 20px 12px",
                fontSize: 12,
                color: "var(--muted)",
              }}
            >
              Изменений: {presentation.changes.length}. Внутренние переносы
              сохраняют количество и партии.
            </caption>
            <thead>
              <tr>
                <th scope="col">Товар / действие</th>
                <th scope="col">Адрес</th>
                <th scope="col">Учёт → факт</th>
                <th scope="col">Остаток, шт.</th>
              </tr>
            </thead>
            <tbody>
              {presentation.changes.map((change, index) => (
                <tr key={`${change.kind}:${change.entityId}:${index}`}>
                  <td>
                    <strong>{change.code}</strong>
                    <small>{changeTitle(change.kind)}</small>
                  </td>
                  <td>
                    {address(change.fromLocationId)}
                    {change.toLocationId &&
                      change.toLocationId !== change.fromLocationId && (
                        <> → {address(change.toLocationId)}</>
                      )}
                  </td>
                  <td>
                    {number(change.expectedQuantity)} →{" "}
                    {number(change.countedQuantity)}
                  </td>
                  <td
                    className={
                      change.unitsDelta < 0
                        ? styles.deltaMinus
                        : change.unitsDelta > 0
                          ? styles.deltaPlus
                          : undefined
                    }
                  >
                    {signed(change.unitsDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.panel}>
          Количественных расхождений и переносов нет.
        </p>
      )}
      {!applied && (
        <p className={styles.footerNote} style={{ padding: "0 20px 20px" }}>
          Недостача сырья относится к известной партии; пустой поддон остаётся
          на складе. Отсутствующие готовые короба списываются целиком.
          Неизвестные коды требуют проверки и блокируют утверждение.
        </p>
      )}
    </section>
  );
}
