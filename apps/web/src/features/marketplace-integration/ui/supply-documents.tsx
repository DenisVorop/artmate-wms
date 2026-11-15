"use client";
import { useState } from "react";
import {
  marketplaceDate,
  marketplaceNumber,
  providerName,
  type MarketplaceSupplyDto,
} from "@/entities/marketplaces";
import { Modal } from "@/shared/ui";
import { supplyNumber } from "../lib/catalog-view";
import styles from "./marketplace-integration.module.css";

function supplyKey(supply: MarketplaceSupplyDto) {
  return `${supply.provider}:${supply.id}`;
}

function SupplyStatus({ supply }: { supply: MarketplaceSupplyDto }) {
  return (
    <>
      {supply.statusLabel}
      {supply.calculation === "review" && (
        <small className={styles.warning}>Нужна проверка</small>
      )}
      {supply.calculation === "excluded" && (
        <small>Не учитывается в плане</small>
      )}
    </>
  );
}

export function SupplyDocuments({
  supplies,
  empty,
}: {
  supplies: MarketplaceSupplyDto[];
  empty: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = supplies.find((supply) => supplyKey(supply) === selectedKey);
  return (
    <section
      className={styles.panel}
      aria-labelledby="marketplace-supplies-title"
    >
      <header className={styles.sectionHeading}>
        <h2 id="marketplace-supplies-title">
          Поставки <small>{supplies.length}</small>
        </h2>
      </header>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица поставок"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Номер</th>
              <th scope="col">Площадка</th>
              <th scope="col">Статус</th>
              <th scope="col">Ожидается</th>
              <th scope="col" className={styles.numeric}>
                Позиций
              </th>
            </tr>
          </thead>
          <tbody>
            {supplies.map((supply) => (
              <tr key={supplyKey(supply)}>
                <th scope="row">
                  <button
                    type="button"
                    className={styles.document}
                    aria-haspopup="dialog"
                    onClick={() => setSelectedKey(supplyKey(supply))}
                  >
                    № {supplyNumber(supply.id)}
                  </button>
                </th>
                <td>{providerName(supply.provider)}</td>
                <td>
                  <SupplyStatus supply={supply} />
                </td>
                <td>
                  {supply.expectedAt ? marketplaceDate(supply.expectedAt) : "—"}
                </td>
                <td className={styles.numeric}>{supply.items.length || "—"}</td>
              </tr>
            ))}
            {!supplies.length && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!selected}
        title={
          selected
            ? `${providerName(selected.provider)} · № ${supplyNumber(selected.id)}`
            : "Поставка"
        }
        onClose={() => setSelectedKey(null)}
      >
        {selected && (
          <div className={styles.productDetail}>
            <dl className={styles.facts}>
              <div>
                <dt>Статус</dt>
                <dd>
                  <SupplyStatus supply={selected} />
                </dd>
              </div>
              <div>
                <dt>Ожидается</dt>
                <dd>
                  {selected.expectedAt
                    ? marketplaceDate(selected.expectedAt)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Передана площадке</dt>
                <dd>
                  {selected.receivedAt
                    ? marketplaceDate(selected.receivedAt)
                    : "—"}
                </dd>
              </div>
            </dl>
            <div
              className={styles.scroll}
              role="region"
              aria-label={`Товары поставки ${supplyNumber(selected.id)}`}
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Товар</th>
                    <th scope="col" className={styles.numeric}>
                      В поставке, шт.
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Принято
                    </th>
                    <th scope="col" className={styles.numeric}>
                      В продаже
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Ожидается
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((item) => (
                    <tr key={item.externalId}>
                      <th scope="row">
                        {item.name}
                        {!item.skuId && <small>Без тематики</small>}
                      </th>
                      <td className={styles.numeric}>
                        {marketplaceNumber(item.plannedUnits)}
                      </td>
                      <td className={styles.numeric}>
                        {marketplaceNumber(item.acceptedUnits)}
                      </td>
                      <td className={styles.numeric}>
                        {marketplaceNumber(item.readyUnits)}
                      </td>
                      <td className={styles.numeric}>
                        {marketplaceNumber(item.pendingUnits)}
                      </td>
                    </tr>
                  ))}
                  {!selected.items.length && (
                    <tr>
                      <td colSpan={5} className={styles.empty}>
                        Состав поставки недоступен.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
