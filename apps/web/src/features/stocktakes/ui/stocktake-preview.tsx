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
      opening_raw: "Первичный остаток сырья",
      opening_finished: "Первичный остаток готовых коробов",
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
            {doc.mode === "opening"
              ? applied
                ? "Внесённые первичные остатки"
                : "Первичные остатки к утверждению"
              : applied
                ? "Применённые изменения"
                : "Расхождения и изменения"}
          </h2>
        </div>
        {presentation.unitsDelta !== null && (
          <div className={styles.subtle}>
            {doc.mode === "opening"
              ? applied
                ? "Внесено на баланс:"
                : "Первичный остаток:"
              : "Изменение остатка:"}{" "}
            <strong
              className={
                presentation.unitsDelta < 0
                  ? styles.deltaMinus
                  : presentation.unitsDelta > 0
                    ? styles.deltaPlus
                    : undefined
              }
            >
              {doc.mode === "opening"
                ? number(presentation.unitsDelta)
                : signed(presentation.unitsDelta)}{" "}
              шт.
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
          Расхождения появятся после подсчёта всех ячеек.
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
              {doc.mode === "opening"
                ? `Адресов с товаром: ${presentation.changes.length}`
                : `Изменений: ${presentation.changes.length}`}
            </caption>
            <thead>
              <tr>
                <th scope="col">Товар / действие</th>
                <th scope="col">Адрес</th>
                <th scope="col">
                  {doc.mode === "opening" ? "Первичный остаток" : "Учёт → факт"}
                </th>
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
                    {doc.mode === "opening"
                      ? address(change.toLocationId)
                      : address(change.fromLocationId)}
                    {doc.mode !== "opening" &&
                      change.toLocationId &&
                      change.toLocationId !== change.fromLocationId && (
                        <> → {address(change.toLocationId)}</>
                      )}
                  </td>
                  <td>
                    {doc.mode === "opening" ? (
                      <>
                        {number(change.countedQuantity)}{" "}
                        {change.kind === "opening_finished" ? "коробов" : "шт."}
                      </>
                    ) : (
                      <>
                        {number(change.expectedQuantity)} →{" "}
                        {number(change.countedQuantity)}
                      </>
                    )}
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
                    {doc.mode === "opening"
                      ? number(change.unitsDelta)
                      : signed(change.unitsDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.panel}>
          {doc.mode === "opening"
            ? "На осмотренных адресах товар не найден."
            : "Количественных расхождений и переносов нет."}
        </p>
      )}
      {!applied && (
        <p className={styles.footerNote} style={{ padding: "0 20px 20px" }}>
          {doc.mode === "opening" ? (
            "Это первичный ввод существующего товара. После утверждения появятся паллеты, короба, партии по датам поступления и этикетки."
          ) : (
            <>
              Недостача сырья относится к известной партии; пустой поддон
              остаётся на складе. Отсутствующие готовые короба списываются
              целиком. Неизвестные коды требуют проверки и блокируют
              утверждение.
            </>
          )}
        </p>
      )}
    </section>
  );
}
