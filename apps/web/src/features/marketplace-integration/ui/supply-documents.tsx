import {
  marketplaceDate,
  marketplaceNumber,
  providerName,
  type MarketplaceSupplyDto,
} from "@/entities/marketplaces";
import { Badge } from "@/shared/ui";
import styles from "./marketplace-integration.module.css";

const reviewLabel = (count: number) => {
  const ending = count % 100;
  if (ending >= 11 && ending <= 14) return `${count} поставок требуют проверки`;
  if (count % 10 === 1) return `${count} поставка требует проверки`;
  if (count % 10 >= 2 && count % 10 <= 4)
    return `${count} поставки требуют проверки`;
  return `${count} поставок требуют проверки`;
};

export function SupplyDocuments({
  supplies,
}: {
  supplies: MarketplaceSupplyDto[];
}) {
  const reviewCount = supplies.filter(
    (supply) => supply.calculation === "review",
  ).length;
  return (
    <details
      id="marketplace-supplies-title"
      className={`glass-panel ${styles.supplies} ${styles.disclosure}`}
    >
      <summary>
        <span>Поставки · {supplies.length}</span>
        {reviewCount > 0 && (
          <span className={styles.warning}>{reviewLabel(reviewCount)}</span>
        )}
      </summary>
      <div className={styles.supplyList}>
        {!supplies.length && (
          <p className={styles.footnote}>
            Поставок пока нет. Обновите данные маркетплейсов.
          </p>
        )}
        {supplies.map((supply) => {
          const number = supply.id.replace(/^(?:supply|preorder):/, "");
          return (
            <details
              className={styles.supply}
              key={`${supply.provider}:${supply.id}`}
            >
              <summary>
                <span className={styles.supplyTitle}>
                  {providerName(supply.provider)} · № {number}
                  <small>{supply.statusLabel}</small>
                </span>
                {supply.calculation === "review" && (
                  <Badge tone="warning">Нужна проверка</Badge>
                )}
              </summary>
              <dl className={styles.supplyFacts}>
                <dt>Ожидаемая дата</dt>
                <dd>
                  {supply.expectedAt
                    ? marketplaceDate(supply.expectedAt)
                    : "Не указана"}
                </dd>
                <dt>Передана маркетплейсу</dt>
                <dd>
                  {supply.receivedAt
                    ? marketplaceDate(supply.receivedAt)
                    : "Дата не указана"}
                </dd>
              </dl>
              {supply.calculation === "review" && (
                <p className={styles.warning}>
                  Данные поставки требуют уточнения. Проверьте её в личном
                  кабинете маркетплейса.
                </p>
              )}
              <div
                className={styles.supplyTableScroll}
                role="region"
                aria-label={`Товары поставки ${number}`}
                tabIndex={0}
              >
                <table className={styles.supplyTable}>
                  <caption>Товары · {supply.items.length} позиций, шт.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Товар</th>
                      <th scope="col">В поставке</th>
                      <th scope="col">Принято</th>
                      <th scope="col">В продаже</th>
                      <th scope="col">Ещё ожидается</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supply.items.map((item) => (
                      <tr key={item.externalId}>
                        <th scope="row">
                          {item.name}
                          {!item.skuId && (
                            <small>Нужно связать с тематикой</small>
                          )}
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
          );
        })}
      </div>
    </details>
  );
}
