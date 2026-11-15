import {
  providerName,
  type MarketplaceProductDto,
} from "@/entities/marketplaces";
import styles from "./marketplace-integration.module.css";

export function ProductTable({
  products,
  skuNames,
  empty,
  onSelect,
}: {
  products: MarketplaceProductDto[];
  skuNames: Map<string, string>;
  empty: string;
  onSelect: (product: MarketplaceProductDto) => void;
}) {
  return (
    <div
      className={styles.scroll}
      role="region"
      aria-label="Таблица товаров"
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Товар</th>
            <th scope="col">Площадка</th>
            <th scope="col">Артикул</th>
            <th scope="col">Тематика склада</th>
            <th scope="col" className={styles.numeric}>
              Шт. в товаре
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={`${product.provider}:${product.externalId}`}>
              <th scope="row">
                <button
                  type="button"
                  className={styles.document}
                  aria-haspopup="dialog"
                  onClick={() => onSelect(product)}
                >
                  {product.name}
                </button>
              </th>
              <td>{providerName(product.provider)}</td>
              <td>{product.offerId || product.externalId}</td>
              <td>
                {product.skuId ? (
                  (skuNames.get(product.skuId) ?? "Тематика недоступна")
                ) : (
                  <span className={styles.warning}>Без тематики</span>
                )}
              </td>
              <td className={styles.numeric}>{product.unitsPerItem}</td>
            </tr>
          ))}
          {!products.length && (
            <tr>
              <td colSpan={5} className={styles.empty}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
