export const providerName = (provider: string) =>
  provider === "wildberries"
    ? "Wildberries"
    : provider === "ozon"
      ? "Ozon"
      : provider;
export const syncLabel = (status: string) =>
  ({
    never: "Не проверено",
    running: "Загрузка…",
    success: "Данные загружены",
    failed: "Ошибка загрузки",
    partial: "Неполные данные",
  })[status] ?? "Неизвестный статус";
export const marketplaceNumber = (
  value: number | null | undefined,
  digits = 0,
) =>
  value == null || !Number.isFinite(value)
    ? "Нет данных"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
        value,
      );
export const marketplaceDate = (value: string | null | undefined) =>
  !value || Number.isNaN(new Date(value).getTime())
    ? "Ещё не было"
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
