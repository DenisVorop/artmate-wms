import {
  isForecastJournalListResponse,
  isForecastJournalDetailResponse,
} from "./forecast-journal-response";
import {
  isForecastOverviewResponse,
  isForecastHistoryOverviewResponse,
  isForecastHistorySeriesResponse,
} from "./forecast-response";
import {
  isMarketplaceOverviewResponse,
  isMarketplaceTaskResponse,
} from "./marketplace-response";
import { isBoxLabelBatchResponse } from "./box-label-response";
import { isPalletLabelBatchResponse } from "./pallet-label-response";
import { isWorkAutomationResponse } from "./work-automation-response";
import { isStocktakeCommandResponse } from "./stocktake-response";
import { isTaskScanResponse } from "./task-scan-response";
import { commandFingerprint, fetchReplaySafeCommand } from "./command-replay";
import {
  getAuthEpoch,
  getCsrfToken,
  requestSessionRefresh,
} from "./auth-memory";
import { ApiError } from "./api-error";
import { isAuthSessionResponse } from "./auth-response";
export { ApiError } from "./api-error";
type Ports = { fetch: typeof fetch; storage: () => Storage };
const sessionEndpoint = (url: string) =>
  /\/api\/auth\/(session|setup|login|logout|change-password)(?:\?|$)/.test(url);
const authEndpoint = (url: string) => /\/api\/auth(?:\/|\?|$)/.test(url);
const marketplaceEndpoint = (url: string) =>
  /\/api\/marketplaces(?:\/|\?|$)/.test(url);
const forecastEndpoint = (url: string) =>
  /\/api\/forecast(?:\/|\?|$)/.test(url);
const credentialEndpoint = (url: string) =>
  /\/api\/auth\/(setup|login|change-password)(?:\?|$)/.test(url);
function errorMessage(data: unknown) {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message))
      return message.filter((item) => typeof item === "string").join(". ");
  }
  return "Не удалось выполнить действие. Попробуйте ещё раз.";
}
/** Credentials and marketplace DTOs bypass the warehouse replay registry. */
export function createApiFetch(ports: Ports) {
  return async function request<T>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> {
    const epoch = getAuthEpoch();
    const method = (options.method ?? "GET").toUpperCase();
    const write = !["GET", "HEAD", "OPTIONS"].includes(method);
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (write) {
      headers.set("X-WMS-Request", "1");
      const csrf = getCsrfToken();
      if (csrf) headers.set("X-WMS-CSRF", csrf);
      else headers.delete("X-WMS-CSRF");
    }
    const init = {
      ...options,
      method,
      headers,
      credentials: "same-origin" as const,
      cache: "no-store" as const,
    };
    let status: number | null = null;
    const send = async (target: string, request: RequestInit) => {
      const response = await ports.fetch(target, request);
      status = response.status;
      return response;
    };
    try {
      let result: T;
      if (
        write &&
        !authEndpoint(url) &&
        !marketplaceEndpoint(url) &&
        !forecastEndpoint(url)
      )
        result = await fetchReplaySafeCommand<T>(url, init, {
          storage: ports.storage,
          fetch: send,
          fingerprint: commandFingerprint,
          ...(/\/api\/task-scans(?:\?|$)/.test(url)
            ? { isResponseConfirmed: isTaskScanResponse }
            : {}),
          ...(/\/api\/box-label-batches(?:\?|$)/.test(url)
            ? { isResponseConfirmed: isBoxLabelBatchResponse }
            : {}),
          ...(/\/api\/pallet-label-batches(?:\?|$)/.test(url)
            ? { isResponseConfirmed: isPalletLabelBatchResponse }
            : {}),
          ...(/\/api\/stocktakes(?:\/|\?|$)/.test(url)
            ? { isResponseConfirmed: isStocktakeCommandResponse }
            : {}),
          ...(/\/api\/work-automation\/settings(?:\?|$)/.test(url)
            ? { isResponseConfirmed: isWorkAutomationResponse }
            : {}),
        });
      else {
        const response = await send(url, init);
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          if (!response.ok)
            throw new ApiError(
              "Сервер не подтвердил действие. Попробуйте ещё раз.",
              response.status,
            );
          throw new ApiError(
            "Сервер вернул некорректный ответ. Обновите данные и повторите действие.",
            response.status,
          );
        }
        if (!response.ok)
          throw new ApiError(errorMessage(data), response.status);
        result = data as T;
      }
      if (
        marketplaceEndpoint(url) &&
        !(/\/api\/marketplaces\/tasks(?:\?|$)/.test(url)
          ? isMarketplaceTaskResponse(result)
          : isMarketplaceOverviewResponse(result))
      )
        throw new ApiError(
          "Сервер вернул некорректные данные маркетплейсов. Повторите загрузку.",
          status,
        );
      if (
        forecastEndpoint(url) &&
        !(/\/api\/forecast\/journal\/[^/?]+(?:\?|$)/.test(url)
          ? isForecastJournalDetailResponse(result)
          : /\/api\/forecast\/journal(?:\?|$)/.test(url)
            ? isForecastJournalListResponse(result)
            : /\/api\/forecast\/history\/series(?:\?|$)/.test(url)
              ? isForecastHistorySeriesResponse(result)
              : /\/api\/forecast\/history(?:\/|\?|$)/.test(url)
                ? isForecastHistoryOverviewResponse(result)
                : isForecastOverviewResponse(result))
      )
        throw new ApiError(
          "Сервер вернул некорректный прогноз. Обновите данные.",
          status,
        );
      if (sessionEndpoint(url) && !isAuthSessionResponse(result))
        throw new ApiError(
          "Сервер вернул некорректное состояние входа. Повторите проверку доступа.",
          status,
        );
      if (
        /\/api\/work-automation(?:\/|\?|$)/.test(url) &&
        !isWorkAutomationResponse(result)
      )
        throw new ApiError(
          "Не удалось прочитать состояние автоматических заданий. Повторите загрузку.",
          status,
        );
      if (!sessionEndpoint(url) && epoch !== getAuthEpoch())
        throw new ApiError(
          "Сессия изменилась. Данные прежнего пользователя отклонены.",
          409,
        );
      return result;
    } catch (error) {
      if (!sessionEndpoint(url) && epoch !== getAuthEpoch())
        throw new ApiError(
          "Сессия изменилась. Данные прежнего пользователя отклонены.",
          409,
        );
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError(
              error instanceof TypeError && status === null
                ? "Нет соединения с сервером. Проверьте сеть и повторите действие."
                : error instanceof Error
                  ? error.message
                  : "Не удалось соединиться с сервером.",
              status,
            );
      if (
        (failure.status === 401 || failure.status === 403) &&
        !credentialEndpoint(url) &&
        !/\/api\/auth\/session(?:\?|$)/.test(url)
      )
        requestSessionRefresh();
      throw failure;
    }
  };
}
export const apiFetch = <T>(url: string, options: RequestInit = {}) =>
  createApiFetch({
    fetch: (...args) => fetch(...args),
    storage: () => window.sessionStorage,
  })<T>(url, options);
