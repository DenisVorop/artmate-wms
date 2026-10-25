import {
  MARKETPLACE_MAX_ATTEMPTS,
  MARKETPLACE_RUN_REQUEST_LIMIT,
  MARKETPLACE_MAX_RESPONSE_BYTES,
  MARKETPLACE_MAX_TOTAL_BYTES,
  MARKETPLACE_REQUEST_TIMEOUT_MS,
  MARKETPLACE_RUN_TIMEOUT_MS,
  OZON_REQUEST_INTERVAL_MS,
  WB_REQUEST_INTERVAL_MS,
  WB_STATISTICS_REQUEST_TIMEOUT_MS,
} from "./request-policy";
import type { MarketplaceFetchOptions } from "./types";

const operations = {
  "https://content-api.wildberries.ru/content/v2/get/cards/list":
    "/content/v2/get/cards/list",
  "https://statistics-api.wildberries.ru/api/v1/supplier/orders":
    "/api/v1/supplier/orders",
  "https://statistics-api.wildberries.ru/api/v1/supplier/sales":
    "/api/v1/supplier/sales",
  "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses":
    "/api/analytics/v1/stocks-report/wb-warehouses",
  "https://supplies-api.wildberries.ru/api/v1/supplies": "/api/v1/supplies",
  "https://api-seller.ozon.ru/v3/supply-order/list": "/v3/supply-order/list",
  "https://api-seller.ozon.ru/v3/supply-order/get": "/v3/supply-order/get",
  "https://api-seller.ozon.ru/v1/supply-order/bundle":
    "/v1/supply-order/bundle",
  "https://api-seller.ozon.ru/v3/product/list": "/v3/product/list",
  "https://api-seller.ozon.ru/v3/product/info/list": "/v3/product/info/list",
  "https://api-seller.ozon.ru/v1/analytics/stocks": "/v1/analytics/stocks",
  "https://api-seller.ozon.ru/v3/posting/fbo/list": "/v3/posting/fbo/list",
} as const;
export type MarketplaceOperation =
  | (typeof operations)[keyof typeof operations]
  | "/api/v1/supplies/{ID}/goods";
export interface MarketplaceProviderDiagnostic {
  readonly operation: MarketplaceOperation;
  readonly status?: number;
  readonly attempt: number;
  readonly retryAfterSeconds?: number;
}

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
    public readonly diagnostic?: Readonly<MarketplaceProviderDiagnostic>,
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

interface HttpRuntime {
  now(): number;
  random(): number;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
const aborted = () =>
  new MarketplaceProviderError("aborted", "Загрузка отменена.");
// Unlike a fetch signal alone, this also interrupts a stalled response stream or
// a non-cooperative transport. Late failures remain observed by Promise.then.
function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    if (signal.aborted) {
      void work.catch(() => undefined);
      return abort();
    }
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
const runtime: HttpRuntime = {
  now: Date.now,
  random: Math.random,
  wait: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      const abort = () => {
        clearTimeout(timer);
        reject(aborted());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal.addEventListener("abort", abort, { once: true });
    }),
};
interface Lane {
  tail: Promise<void>;
  cooldownUntil: number;
  nextStarts: Map<string, number>;
}
class RequestQueue {
  private readonly _lanes = new Map<string, Lane>();
  async run<T>(
    provider: string,
    signal: AbortSignal,
    work: (lane: Lane) => Promise<T>,
  ) {
    let lane = this._lanes.get(provider);
    if (!lane) {
      lane = {
        tail: Promise.resolve(),
        cooldownUntil: 0,
        nextStarts: new Map(),
      };
      this._lanes.set(provider, lane);
    }
    const previous = lane.tail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    lane.tail = previous.then(() => gate);
    let acquired = false;
    try {
      await interruptible(previous, signal);
      acquired = true;
      if (signal.aborted) throw aborted();
      return await work(lane);
    } finally {
      // A cancelled waiter must not let following requests pass a running one.
      if (acquired) release();
      else void previous.then(release);
    }
  }
}
const sharedQueue = new RequestQueue();
// Accept only safe integer seconds/IMF-fixdate, without keeping arbitrary
// upstream header strings or allowing Infinity to poison the process lane.
function retryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  if (
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      trimmed,
    )
  )
    return undefined;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toUTCString() === trimmed
    ? Math.max(0, Math.ceil((timestamp - now) / 1000))
    : undefined;
}
function serverDelay(response: Response, isWb: boolean, now: number) {
  const values = [retryAfter(response.headers.get("Retry-After"), now)];
  if (isWb) {
    for (const header of ["X-Ratelimit-Retry", "X-Ratelimit-Reset"]) {
      const value = response.headers.get(header)?.trim();
      if (
        value !== undefined &&
        /^\d+$/.test(value) &&
        Number.isSafeInteger(Number(value))
      )
        values.push(Number(value));
    }
  }
  const valid = values.filter((value): value is number => value !== undefined);
  return valid.length ? Math.max(...valid) : undefined;
}
const limitError = (operation?: MarketplaceOperation, attempt?: number) =>
  new MarketplaceProviderError(
    "limit",
    "Загрузка превысила безопасный размер. Сократите период.",
    operation === undefined ? undefined : { operation, attempt: attempt! },
  );
function buildClient(
  headers: Record<string, string>,
  options: MarketplaceFetchOptions,
  clock: HttpRuntime,
  queue: RequestQueue,
  paced: boolean,
) {
  let count = 0;
  let totalBytes = 0;
  const deadline = clock.now() + MARKETPLACE_RUN_TIMEOUT_MS;
  const runSignal = AbortSignal.any([
    AbortSignal.timeout(MARKETPLACE_RUN_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  return async (url: string, body?: unknown): Promise<unknown> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw limitError();
    }
    const key = `${parsed.origin}${parsed.pathname}`;
    const supplyGoods =
      parsed.origin === "https://supplies-api.wildberries.ru" &&
      /^\/api\/v1\/supplies\/[1-9]\d{0,19}\/goods$/.test(parsed.pathname);
    if (
      (!Object.hasOwn(operations, key) && !supplyGoods) ||
      parsed.username ||
      parsed.password
    )
      throw limitError();
    const operation: MarketplaceOperation = supplyGoods
      ? "/api/v1/supplies/{ID}/goods"
      : operations[key as keyof typeof operations];
    const isWb = parsed.hostname !== "api-seller.ozon.ru";
    const provider = isWb ? "wildberries" : "ozon";
    const group =
      parsed.hostname === "statistics-api.wildberries.ru"
        ? "statistics"
        : parsed.hostname === "seller-analytics-api.wildberries.ru"
          ? "analytics"
          : parsed.hostname === "content-api.wildberries.ru"
            ? "content"
            : "supplies";
    const pacingKey = isWb ? group : "ozon";
    const interval = isWb
      ? WB_REQUEST_INTERVAL_MS[group]
      : OZON_REQUEST_INTERVAL_MS;
    const requestTimeout =
      isWb && group === "statistics"
        ? WB_STATISTICS_REQUEST_TIMEOUT_MS
        : MARKETPLACE_REQUEST_TIMEOUT_MS;
    for (let attempt = 1; ; attempt++) {
      const result = await queue.run(provider, runSignal, async (lane) => {
        const diagnostic = { operation, attempt };
        const remaining =
          Math.max(
            lane.cooldownUntil,
            paced ? (lane.nextStarts.get(pacingKey) ?? 0) : 0,
          ) - clock.now();
        if (remaining >= deadline - clock.now())
          throw new MarketplaceProviderError(
            "rate_limit",
            "Лимит запросов маркетплейса. Повторим загрузку позже.",
            diagnostic,
          );
        if (remaining > 0) await clock.wait(remaining, runSignal);
        if (runSignal.aborted || clock.now() >= deadline) throw aborted();
        if (count >= MARKETPLACE_RUN_REQUEST_LIMIT)
          throw limitError(operation, attempt);
        count++;
        if (paced) lane.nextStarts.set(pacingKey, clock.now() + interval);
        const attemptSignal = AbortSignal.any([
          runSignal,
          AbortSignal.timeout(requestTimeout),
        ]);
        let response: Response;
        try {
          response = await interruptible(
            Promise.resolve()
              .then(() =>
                (options.fetch ?? globalThis.fetch)(url, {
                  method: body === undefined ? "GET" : "POST",
                  headers: {
                    ...headers,
                    Accept: "application/json",
                    ...(body === undefined
                      ? {}
                      : { "Content-Type": "application/json" }),
                  },
                  body: body === undefined ? undefined : JSON.stringify(body),
                  redirect: "error",
                  signal: attemptSignal,
                }),
              )
              .then((received) => {
                if (attemptSignal.aborted) {
                  void received.body?.cancel().catch(() => undefined);
                  throw aborted();
                }
                return received;
              }),
            attemptSignal,
          );
        } catch {
          if (runSignal.aborted || clock.now() >= deadline) throw aborted();
          return retry(
            new MarketplaceProviderError(
              "unavailable",
              "Маркетплейс недоступен. Повторим загрузку позже.",
              diagnostic,
            ),
          );
        }
        const responseDiagnostic = { ...diagnostic, status: response.status };
        if (!response.ok) {
          // Never read an upstream error body: it can contain private data.
          try {
            await interruptible(
              response.body?.cancel() ?? Promise.resolve(),
              attemptSignal,
            );
          } catch {
            /* safe discard */
          }
          if (runSignal.aborted) throw aborted();
          if (response.status === 401 || response.status === 403)
            throw new MarketplaceProviderError(
              "credentials",
              "Проверьте ключ и права доступа к каталогу, заказам и остаткам.",
              responseDiagnostic,
            );
          if (
            response.status === 429 ||
            [502, 503, 504].includes(response.status)
          ) {
            const seconds = serverDelay(response, isWb, clock.now());
            return retry(
              new MarketplaceProviderError(
                response.status === 429 ? "rate_limit" : "unavailable",
                response.status === 429
                  ? "Лимит запросов маркетплейса. Повторим загрузку позже."
                  : "Маркетплейс недоступен. Повторим загрузку позже.",
                {
                  ...responseDiagnostic,
                  ...(seconds !== undefined && Number.isSafeInteger(seconds)
                    ? { retryAfterSeconds: seconds }
                    : {}),
                },
              ),
              seconds,
            );
          }
          throw new MarketplaceProviderError(
            "unavailable",
            "Маркетплейс не выполнил запрос. Попробуйте позже.",
            responseDiagnostic,
          );
        }
        if (response.status === 204) return { value: null };
        try {
          const reader = response.body?.getReader();
          if (!reader) return invalid();
          let bytes = 0;
          const chunks: Uint8Array[] = [];
          try {
            while (true) {
              const next = await interruptible(reader.read(), attemptSignal);
              if (next.done) break;
              bytes += next.value.byteLength;
              totalBytes += next.value.byteLength;
              if (
                bytes > MARKETPLACE_MAX_RESPONSE_BYTES ||
                totalBytes > MARKETPLACE_MAX_TOTAL_BYTES
              ) {
                void reader.cancel().catch(() => undefined);
                return invalid();
              }
              chunks.push(next.value);
            }
          } catch (error) {
            void reader.cancel().catch(() => undefined);
            if (runSignal.aborted) throw aborted();
            if (attemptSignal.aborted)
              return retry(
                new MarketplaceProviderError(
                  "unavailable",
                  "Маркетплейс не передал ответ вовремя. Повторим загрузку позже.",
                  responseDiagnostic,
                ),
              );
            if (error instanceof MarketplaceProviderError) throw error;
            return retry(
              new MarketplaceProviderError(
                "unavailable",
                "Маркетплейс прервал передачу данных. Повторим загрузку позже.",
                responseDiagnostic,
              ),
            );
          }
          return {
            value: JSON.parse(
              Buffer.concat(chunks).toString("utf8"),
            ) as unknown,
          };
        } catch (error) {
          if (error instanceof MarketplaceProviderError) throw error;
          return invalid();
        }
        function retry(
          error: MarketplaceProviderError,
          seconds?: number,
        ): { retry: true } {
          const backoff =
            Math.min(30_000, 1_000 * 2 ** (attempt - 1)) *
            (1 + clock.random() * 0.25);
          const delay = Math.max(backoff, (seconds ?? 0) * 1000);
          const until = clock.now() + delay;
          // An overflowing upstream delay must stop this attempt without poisoning
          // the shared queue forever. Ordinary representable server delays remain
          // authoritative even when they exceed this run's remaining budget.
          if (!Number.isSafeInteger(Math.ceil(until)) || until > 8.64e15) {
            lane.cooldownUntil = Math.max(
              lane.cooldownUntil,
              clock.now() + backoff,
            );
            throw error;
          }
          // Store before releasing the lane, including the final failed attempt.
          lane.cooldownUntil = Math.max(lane.cooldownUntil, until);
          if (
            attempt >= MARKETPLACE_MAX_ATTEMPTS ||
            delay >= deadline - clock.now()
          )
            throw error;
          return { retry: true };
        }
      });
      if ("value" in result) return result.value;
    }
  };
}
export function client(
  headers: Record<string, string>,
  options: MarketplaceFetchOptions,
) {
  // Custom transports are fixture-only; they do not inherit live global pacing.
  return buildClient(
    headers,
    options,
    runtime,
    options.fetch ? new RequestQueue() : sharedQueue,
    !options.fetch,
  );
}
/** Inject time only through this test factory, never through provider/HTTP options. */
export function createHttpClientForTesting(clock: HttpRuntime) {
  const queue = new RequestQueue();
  return (headers: Record<string, string>, options: MarketplaceFetchOptions) =>
    buildClient(headers, options, clock, queue, true);
}
