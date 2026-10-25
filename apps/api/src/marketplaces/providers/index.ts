import { MarketplaceProviderError } from "./http";
import { ozon } from "./ozon";
import type {
  MarketplaceCredentials,
  MarketplaceFetchOptions,
  MarketplacePeriod,
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "./types";
import { wildberries } from "./wildberries";
export * from "./types";
export { MarketplaceProviderError } from "./http";

export async function fetchMarketplaceSnapshot(
  provider: MarketplaceProvider,
  credentials: MarketplaceCredentials,
  period: MarketplacePeriod,
  options: MarketplaceFetchOptions = {},
): Promise<MarketplaceSnapshot> {
  const date = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  const days =
    (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1;
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  if (
    !date(period.from) ||
    !date(period.to) ||
    days < 1 ||
    days > 89 ||
    period.to >= today
  )
    throw new MarketplaceProviderError(
      "limit",
      "Выберите от 1 до 89 полных дней до сегодняшнего дня.",
    );
  if (
    provider === "wildberries" &&
    Date.parse(period.from) < Date.parse(today) - 89 * 86_400_000
  )
    throw new MarketplaceProviderError(
      "limit",
      "Wildberries хранит оперативные заказы не более 90 дней. Выберите более свежий период.",
    );
  if (
    !credentials.apiKey ||
    credentials.apiKey.length > 8192 ||
    /[\r\n\u0000]/.test(credentials.apiKey) ||
    (provider === "ozon" &&
      (!credentials.clientId || !/^\d{1,30}$/.test(credentials.clientId)))
  )
    throw new MarketplaceProviderError(
      "credentials",
      "Укажите ключ API и Client ID для Ozon.",
    );
  if (provider === "wildberries")
    return wildberries(credentials, period, options);
  if (provider === "ozon") return ozon(credentials, period, options);
  throw new MarketplaceProviderError("credentials", "Неизвестный маркетплейс.");
}
