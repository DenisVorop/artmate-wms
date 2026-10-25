import type { MarketplaceFetchOptions } from "./types";

export class MarketplaceProviderError extends Error {
  constructor(
    public readonly code:
      | "credentials"
      | "rate_limit"
      | "unavailable"
      | "invalid_response"
      | "limit"
      | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "MarketplaceProviderError";
  }
}
export const invalid = (): never => {
  throw new MarketplaceProviderError(
    "invalid_response",
    "Маркетплейс вернул неполные или неожиданные данные. Предыдущая загрузка сохранена.",
  );
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(object);
}
export function id(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value !== 0)
    return String(value);
  if (typeof value === "string" && value.length > 0 && value.length <= 200)
    return value;
  return invalid();
}
export function units(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return invalid();
  return value;
}
export function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.slice(0, 500)
    : fallback;
}
export function barcodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string"))
    return invalid();
  return [...new Set(value as string[])];
}
export function moscowDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value))
    return invalid();
  const timestamp = new Date(
    /[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}+03:00`,
  ).getTime();
  if (!Number.isFinite(timestamp)) return invalid();
  return new Date(timestamp + 3 * 3_600_000).toISOString().slice(0, 10);
}
const endpoints = new Set([
  "https://content-api.wildberries.ru/content/v2/get/cards/list",
  "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
  "https://statistics-api.wildberries.ru/api/v1/supplier/sales",
  "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
  "https://api-seller.ozon.ru/v3/product/list",
  "https://api-seller.ozon.ru/v3/product/info/list",
  "https://api-seller.ozon.ru/v1/analytics/stocks",
  "https://api-seller.ozon.ru/v3/posting/fbo/list",
]);
const lastRequests = new Map<string, number>();
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted)
      return reject(
        new MarketplaceProviderError("aborted", "Загрузка отменена."),
      );
    const abort = () => {
      clearTimeout(timer);
      reject(new MarketplaceProviderError("aborted", "Загрузка отменена."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
export function client(
  headers: Record<string, string>,
  options: MarketplaceFetchOptions,
) {
  let count = 0;
  let totalBytes = 0;
  const runSignal = AbortSignal.any([
    AbortSignal.timeout(240_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  return async (url: string, body?: unknown): Promise<unknown> => {
    const parsed = new URL(url);
    if (
      !endpoints.has(`${parsed.origin}${parsed.pathname}`) ||
      parsed.username ||
      parsed.password ||
      ++count > 180
    )
      throw new MarketplaceProviderError(
        "limit",
        "Загрузка превысила безопасный размер. Сократите период.",
      );
    // A fake transport is used only by fixture tests; real HTTP respects endpoint pacing.
    const key = `${parsed.origin}${parsed.pathname}`;
    const interval =
      parsed.hostname === "statistics-api.wildberries.ru"
        ? 60_100
        : parsed.hostname === "seller-analytics-api.wildberries.ru"
          ? 20_100
          : parsed.hostname === "content-api.wildberries.ru"
            ? 650
            : 250;
    if (!options.fetch) {
      const remaining = (lastRequests.get(key) ?? 0) + interval - Date.now();
      if (remaining > 0) await wait(remaining, runSignal);
      lastRequests.set(key, Date.now());
    }
    if (runSignal.aborted)
      throw new MarketplaceProviderError("aborted", "Загрузка отменена.");
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...headers,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.any([runSignal, AbortSignal.timeout(30_000)]),
      });
    } catch {
      throw new MarketplaceProviderError(
        runSignal.aborted ? "aborted" : "unavailable",
        runSignal.aborted
          ? "Загрузка отменена или превысила время ожидания."
          : "Маркетплейс недоступен. Попробуйте позже.",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new MarketplaceProviderError(
        "credentials",
        "Проверьте ключ и права доступа к каталогу, заказам и остаткам.",
      );
    if (response.status === 429)
      throw new MarketplaceProviderError(
        "rate_limit",
        "Лимит запросов маркетплейса. Повторите загрузку позже.",
      );
    if (!response.ok)
      throw new MarketplaceProviderError(
        "unavailable",
        "Маркетплейс не выполнил запрос. Попробуйте позже.",
      );
    if (response.status === 204) return null;
    // Never expose upstream bodies, URLs or headers in errors: they can contain credentials.
    try {
      const reader = response.body?.getReader();
      if (!reader) return invalid();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        totalBytes += next.value.byteLength;
        if (bytes > 20_000_000 || totalBytes > 80_000_000) {
          await reader.cancel();
          return invalid();
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      return invalid();
    }
  };
}
