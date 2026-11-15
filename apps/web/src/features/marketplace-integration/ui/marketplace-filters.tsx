import { Search } from "lucide-react";
import { Input, Select } from "@/shared/ui";
import styles from "./marketplace-integration.module.css";

export function MarketplaceFilters({
  provider,
  search,
  mapping,
  supply,
  onProvider,
  onSearch,
  onMapping,
  onSupply,
}: {
  provider: string;
  search: string;
  mapping: string;
  supply: string;
  onProvider: (value: string) => void;
  onSearch: (value: string) => void;
  onMapping: (value: string) => void;
  onSupply: (value: string) => void;
}) {
  return (
    <div
      className={styles.filters}
      role="group"
      aria-label="Фильтры товаров и поставок"
    >
      <label className="field">
        Площадка
        <Select
          value={provider}
          onChange={(event) => onProvider(event.target.value)}
        >
          <option value="">Все площадки</option>
          <option value="wildberries">Wildberries</option>
          <option value="ozon">Ozon</option>
        </Select>
      </label>
      <label className="field">
        Привязка товара
        <Select
          value={mapping}
          onChange={(event) => onMapping(event.target.value)}
        >
          <option value="">Все товары</option>
          <option value="linked">С тематикой</option>
          <option value="unlinked">Без тематики</option>
        </Select>
      </label>
      <label className="field">
        Поставки
        <Select
          value={supply}
          onChange={(event) => onSupply(event.target.value)}
        >
          <option value="">Все поставки</option>
          <option value="review">Требуют проверки</option>
        </Select>
      </label>
      <label className="field">
        Поиск
        <span className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            placeholder="Товар, артикул, № поставки"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </span>
      </label>
    </div>
  );
}
