import { ChevronDown, Search } from "lucide-react";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { number } from "@/shared/lib/format";
import { Input, Select } from "@/shared/ui";
import {
  dispatchLabel,
  needsAssembly,
  planningGroups,
  planningRows,
  planningStatus,
  type PlanningFilter,
} from "../lib/planning-view";
import styles from "./assembly-planning.module.css";

const filters: { value: PlanningFilter; label: string }[] = [
  { value: "all", label: "Все товары" },
  { value: "shipping", label: "К ближайшей отправке" },
  { value: "assembly", label: "Нужно собрать" },
  { value: "review", label: "Нужна проверка" },
];

export function PlanningTable({
  rows,
  totals,
  dispatchDate,
  preparationThrough,
  filter,
  search,
  onFilter,
  onSearch,
  onSelect,
}: {
  rows: MarketplacePlanRowDto[];
  totals: ReturnType<typeof planningGroups>;
  dispatchDate: string;
  preparationThrough: string;
  filter: PlanningFilter;
  search: string;
  onFilter: (filter: PlanningFilter) => void;
  onSearch: (search: string) => void;
  onSelect: (id: string) => void;
}) {
  const query = search.trim().toLocaleLowerCase("ru-RU");
  const visible = planningRows(rows, filter).filter((row) =>
    row.skuName.toLocaleLowerCase("ru-RU").includes(query),
  );
  const reviewCount = rows.length - totals.completeCount;

  return (
    <section className={styles.panel} aria-label="План поставок и сборки">
      <div className={styles.filters} role="group" aria-label="Фильтры плана">
        <label className={styles.filterField}>
          Показать
          <span className={styles.bucket}>
            <Select
              value={filter}
              onChange={(event) => {
                const next = filters.find(
                  ({ value }) => value === event.target.value,
                );
                if (next) onFilter(next.value);
              }}
            >
              {filters.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        <label className={styles.filterField}>
          Поиск
          <span className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              placeholder="Название товара"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </span>
        </label>
      </div>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица плана поставок и сборки"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Товар</th>
              <th scope="col" className={styles.numeric}>
                Ближайшая отправка
                <small>{dispatchLabel(dispatchDate)} · кор.</small>
              </th>
              <th scope="col" className={styles.numeric}>
                Останется<small>после отправки · кор.</small>
              </th>
              <th scope="col" className={styles.numeric}>
                Отправить за месяц
                <small>до {dispatchLabel(preparationThrough)} · кор.</small>
              </th>
              <th scope="col" className={styles.numeric}>
                Собрать за месяц
                <small>до {dispatchLabel(preparationThrough)} · кор.</small>
              </th>
              <th scope="col" className={styles.numeric}>
                Прогноз продаж<small>30 дней · шт.</small>
              </th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const complete =
                row.dataComplete && row.advice.state !== "review";
              const rest = complete
                ? row.localAfterDispatchUnits % row.unitsPerBox
                : 0;
              const scenario = row.providers.some((source) => source.scenario);
              return (
                <tr key={row.skuId}>
                  <th scope="row">
                    <button
                      className={styles.document}
                      type="button"
                      onClick={() => onSelect(row.skuId)}
                    >
                      {row.skuName}
                    </button>
                  </th>
                  <td className={styles.numeric}>
                    {complete ? number(row.outboundBoxes) : "—"}
                  </td>
                  <td className={styles.numeric}>
                    {complete
                      ? number(
                          Math.floor(
                            row.localAfterDispatchUnits / row.unitsPerBox,
                          ),
                        )
                      : "—"}
                    {rest > 0 && <small>+ {number(rest)} шт.</small>}
                  </td>
                  <td className={styles.numeric}>
                    {complete ? number(row.monthlyOutboundBoxes) : "—"}
                  </td>
                  <td className={styles.numeric}>
                    {complete
                      ? number(needsAssembly(row) ? row.recommendedBoxes : 0)
                      : "—"}
                  </td>
                  <td className={styles.numeric}>
                    {row.salesForecastKnown
                      ? `≈ ${number(row.expectedSalesUnits30)}`
                      : "—"}
                    {row.salesForecastKnown && scenario && (
                      <small>Сценарий</small>
                    )}
                  </td>
                  <td className={styles.status} data-state={row.advice.state}>
                    {planningStatus[row.advice.state]}
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={7} className={styles.empty}>
                  {query
                    ? "Товары не найдены."
                    : "По этому фильтру товаров нет."}
                </td>
              </tr>
            )}
          </tbody>
          {totals.completeCount > 0 && (
            <tfoot>
              <tr>
                <th scope="row">Итого по плану</th>
                <td className={styles.numeric}>
                  {number(totals.outboundBoxes)}
                </td>
                <td className={styles.numeric}>
                  {number(totals.remainingBoxes)}
                  {totals.partialBoxes && <small>и неполные короба</small>}
                </td>
                <td className={styles.numeric}>
                  {number(totals.monthlyOutboundBoxes)}
                </td>
                <td className={styles.numeric}>{number(totals.boxes)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {reviewCount > 0 && (
        <p className={styles.tableNote}>
          Товаров без полного расчёта: {number(reviewCount)}
        </p>
      )}
    </section>
  );
}
