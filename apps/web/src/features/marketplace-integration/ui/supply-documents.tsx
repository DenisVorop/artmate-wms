import {
  marketplaceDate,
  marketplaceNumber,
  providerName,
  type MarketplaceSupplyDto,
} from "@/entities/marketplaces";
import { Badge } from "@/shared/ui";
import styles from "./marketplace-integration.module.css";

const calculationLabel = (value: MarketplaceSupplyDto["calculation"]) =>
  ({
    document: "Учтено по документу",
    analytics: "Учтено по аналитике",
    excluded: "Не входит в товар в пути",
    review: "Нужна проверка",
  })[value];

export function SupplyDocuments({
  supplies,
}: {
  supplies: MarketplaceSupplyDto[];
}) {
  const reviewCount = supplies.filter(
    (supply) => supply.calculation === "review",
  ).length;
  return (
    <section
      className={`glass-panel ${styles.supplies}`}
      aria-labelledby="marketplace-supplies-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="marketplace-supplies-title">Поставки на маркетплейсы</h2>
          <p>
            Обновляются вместе с продажами. Товар в пути автоматически уменьшает
            потребность в сборке.
          </p>
        </div>
        <span className={styles.count}>{supplies.length} документов</span>
      </div>
      {reviewCount > 0 && (
        <p className={`${styles.warning} ${styles.supplyNotice}`} role="status">
          Требуют проверки: {reviewCount}. Неизвестные количества не считаются
          нулевыми.
        </p>
      )}
      <details className={styles.supplyList}>
        <summary>Документы и источник расчёта</summary>
        <p className={styles.footnote}>
          WB учитывается по документам поставок. Ozon — по аналитике товара в
          пути и на приёмке; количества документов Ozon повторно не
          прибавляются. В документах ниже указаны единицы площадки, до пересчёта
          в книги или наборы WMS.
        </p>
        {!supplies.length && (
          <p className={styles.footnote}>
            Документов в последней загрузке нет. Подтверждение товара в пути
            смотрите в плане сборки отдельно по каждой площадке.
          </p>
        )}
        {supplies.map((supply) => (
          <details
            className={styles.supply}
            key={`${supply.provider}:${supply.id}`}
          >
            <summary>
              <span className={styles.supplyTitle}>
                {providerName(supply.provider)} · № {supply.id}
                <small>{supply.statusLabel}</small>
              </span>
              <Badge
                tone={
                  supply.calculation === "review"
                    ? "warning"
                    : supply.calculation === "excluded"
                      ? "neutral"
                      : "success"
                }
              >
                {calculationLabel(supply.calculation)}
              </Badge>
            </summary>
            <dl className={styles.supplyFacts}>
              <dt>Ожидаемая дата</dt>
              <dd>
                {supply.expectedAt
                  ? marketplaceDate(supply.expectedAt)
                  : "Не указана"}
              </dd>
              <dt>Дата приёмки</dt>
              <dd>
                {supply.receivedAt
                  ? marketplaceDate(supply.receivedAt)
                  : "Не указана"}
              </dd>
              <dt>Обновлено</dt>
              <dd>
                {supply.updatedAt
                  ? marketplaceDate(supply.updatedAt)
                  : "Не указано"}
              </dd>
            </dl>
            {supply.calculation === "analytics" && (
              <p className={styles.footnote}>
                План использует аналитику Ozon. Остаток этого документа отдельно
                к ней не прибавляется.
              </p>
            )}
            {supply.calculation === "excluded" && (
              <p className={styles.footnote}>
                Этот статус не пополняет товар в пути в расчёте сборки.
              </p>
            )}
            {supply.warnings.map((warning) => (
              <p key={warning} className={styles.warning}>
                {warning}
              </p>
            ))}
            <div
              className={styles.supplyTableScroll}
              role="region"
              aria-label={`Товары поставки ${supply.id}`}
              tabIndex={0}
            >
              <table className={styles.supplyTable}>
                <caption>
                  Единицы площадки · {supply.items.length} позиций
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col">Заявлено</th>
                    <th scope="col">Принято</th>
                    <th scope="col">Готово к продаже</th>
                    <th scope="col">Ожидается</th>
                  </tr>
                </thead>
                <tbody>
                  {supply.items.map((item) => (
                    <tr key={item.externalId}>
                      <th scope="row">
                        {item.name}
                        <small>
                          {item.externalId}
                          {!item.skuId && " · Нет связи с тематикой"}
                        </small>
                      </th>
                      <td>{marketplaceNumber(item.plannedUnits)}</td>
                      <td>{marketplaceNumber(item.acceptedUnits)}</td>
                      <td>{marketplaceNumber(item.readyUnits)}</td>
                      <td>{marketplaceNumber(item.pendingUnits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </details>
    </section>
  );
}
