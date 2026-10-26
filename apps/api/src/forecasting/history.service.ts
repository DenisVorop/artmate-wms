import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { validateSync } from "class-validator";
import { WarehouseService } from "../warehouse.service";
import type { Queryable } from "../database";
import { requireAuth } from "../auth-policy";
import { requestAuth } from "../auth-context";
import {
  loadMarketplaces,
  put,
  type Connection,
} from "../marketplaces/storage";
import { MarketplaceSecrets } from "../marketplaces/secrets";
import type { MarketplaceCredentials } from "../marketplaces/providers/types";
import { MARKETPLACE_RUN_LEASE_MS } from "../marketplaces/providers/request-policy";
import {
  fetchOzonHistoryPage,
  fetchWbFinanceHistoryPage,
  fetchWbSellerId,
} from "./history-providers";
import {
  bootstrapForecastHistory,
  bumpForecastHistoryRevision,
  historyId,
  historyPut,
  historyRows,
  historyStore,
  loadForecastHistorySeries,
  loadHistoryJobs,
} from "./history-storage";
import type { HistoryCoverage, HistoryFact, HistoryJob } from "./history-types";
import * as D from "./history.dto";
const PAGE_TIMEOUT = 180_000;
const today = () => new Date(Date.now() + 10800000).toISOString().slice(0, 10);
function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function monthEnd(from: string, to: string) {
  const d = new Date(`${from}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10) < to
    ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
        .toISOString()
        .slice(0, 10)
    : to;
}
@Injectable()
export class ForecastHistoryService {
  private readonly secrets = new MarketplaceSecrets();
  private readonly fetchPage = fetchOzonHistoryPage;
  private readonly fetchFinancePage = fetchWbFinanceHistoryPage;
  private readonly fetchSellerId = fetchWbSellerId;
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  static forTesting(
    warehouse: WarehouseService,
    secrets: MarketplaceSecrets,
    fetchPage: typeof fetchOzonHistoryPage,
    fetchFinancePage: typeof fetchWbFinanceHistoryPage = fetchWbFinanceHistoryPage,
    fetchSellerId: typeof fetchWbSellerId = fetchWbSellerId,
  ) {
    const s = new ForecastHistoryService(warehouse);
    Object.assign(s, { secrets, fetchPage, fetchFinancePage, fetchSellerId });
    return s;
  }
  private async _manager(tx: Queryable, write = false) {
    const actor = await requireAuth(tx, write);
    if (actor.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
    return actor;
  }
  private _internal() {
    if (requestAuth.getStore()?.http)
      throw new ForbiddenException("Фоновая загрузка недоступна через HTTP");
  }
  private async _overview(
    tx: Queryable,
  ): Promise<D.ForecastHistoryOverviewDto> {
    const m = await loadMarketplaces(tx),
      facts = await historyRows<HistoryFact>(tx, "forecast_history_facts"),
      coverages = await historyRows<HistoryCoverage>(
        tx,
        "forecast_history_coverage",
      ),
      jobs = await loadHistoryJobs(tx);
    return {
      providers: (["wildberries", "ozon"] as const).map((provider) => {
        const c = m.connections.find((c) => c.provider === provider),
          storeId = c?.historyStoreId;
        const cs = coverages.filter(
          (x) => x.provider === provider && x.storeId === storeId,
        );
        const dates = new Set<string>();
        for (const range of cs)
          for (
            let d = Date.parse(range.from);
            d <= Date.parse(range.to);
            d += 86400000
          )
            dates.add(new Date(d).toISOString().slice(0, 10));
        const sorted = [...dates].sort();
        return {
          provider,
          financeConfigured: !!c?.financeEncrypted,
          from: sorted[0] ?? null,
          to: sorted.at(-1) ?? null,
          knownDays: dates.size,
          products: new Set(
            facts.filter((f) => f.storeId === storeId).map((f) => f.externalId),
          ).size,
          message:
            provider === "wildberries"
              ? "Текущие заказы сохраняются. Для старой истории нужен доступ «Финансы». Историческое наличие неизвестно."
              : "История FBO загружается постепенно. Заказы и текущие отмены; историческое наличие неизвестно.",
        };
      }),
      jobs: jobs
        .filter((j) =>
          m.connections.some(
            (c) => c.provider === j.provider && c.historyStoreId === j.storeId,
          ),
        )
        .map((j) => ({
          id: j.id,
          provider: j.provider,
          from: j.from,
          to: j.to,
          loadedThrough:
            j.status === "complete"
              ? j.to
              : j.monthFrom === j.from
                ? ""
                : new Date(Date.parse(j.monthFrom) - 86400000)
                    .toISOString()
                    .slice(0, 10),
          status: j.status,
          message: j.message,
          pages: j.pages,
        })),
    };
  }
  async getForecastHistory() {
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      return this._overview(tx);
    });
  }
  async getForecastHistorySeries(skuId: string) {
    if (typeof skuId !== "string" || !skuId || skuId.length > 200)
      throw new BadRequestException("Выберите тематику");
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      const m = await loadMarketplaces(tx);
      const active = new Set(
        m.connections.filter((c) => c.enabled).map((c) => c.historyStoreId),
      );
      return (await loadForecastHistorySeries(tx, m.mappings, today())).filter(
        (s) => s.skuId === skuId && active.has(s.storeId),
      );
    });
  }
  async connectForecastFinance(
    b: D.ConnectForecastFinanceDto,
  ): Promise<D.ForecastHistoryOverviewDto> {
    if (
      validateSync(Object.assign(new D.ConnectForecastFinanceDto(), b), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length ||
      !b.apiKey.trim()
    )
      throw new BadRequestException(
        "Введите ключ WB с доступом к финансовой истории",
      );
    // The first transaction only authorizes and captures a stable connection version.
    const initial = await this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true),
        fingerprint = await this.secrets.fingerprint([
          "forecast/connectFinance",
          b,
          actor.id,
        ]);
      const cached = await this._financePrevious(tx, b.requestId, fingerprint);
      if (cached) return { cached };
      const c = (await loadMarketplaces(tx)).connections.find(
        (c) => c.provider === "wildberries",
      );
      if (!c?.enabled) throw new BadRequestException("Сначала подключите WB");
      return {
        actorId: actor.id,
        fingerprint,
        version: c.version,
        financeVersion: c.financeVersion,
        encrypted: c.encrypted,
        storeId: historyStore(c),
        sellerId: c.historySellerId,
      };
    });
    if ("cached" in initial) return initial.cached!;
    let sellerId: string;
    const signal = AbortSignal.timeout(180_000);
    try {
      const operational = await this.secrets.decrypt<MarketplaceCredentials>(
        initial.encrypted,
        "wildberries",
      );
      sellerId = await this.fetchSellerId(operational, { signal });
      const financeSellerId = await this.fetchSellerId(
        { apiKey: b.apiKey.trim() },
        { signal },
      );
      if (
        sellerId !== financeSellerId ||
        (initial.sellerId && initial.sellerId !== sellerId)
      )
        throw new Error("seller-mismatch");
      signal.throwIfAborted();
    } catch {
      throw new BadRequestException(
        "Не удалось подтвердить, что оба ключа принадлежат одному магазину WB. Проверьте ключ и выбранного продавца.",
      );
    }
    const encrypted = await this.secrets.encrypt(
      { apiKey: b.apiKey.trim() },
      `forecast-finance:${initial.storeId}`,
    );
    // Role, CSRF, replay and connection identity are checked again after the network wait.
    return this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true);
      if (actor.id !== initial.actorId)
        throw new ForbiddenException("Сессия изменилась. Войдите снова");
      const cached = await this._financePrevious(
        tx,
        b.requestId,
        initial.fingerprint,
      );
      if (cached) return cached;
      const c = (await loadMarketplaces(tx)).connections.find(
        (c) => c.provider === "wildberries",
      );
      if (
        !c?.enabled ||
        c.version !== initial.version ||
        c.financeVersion !== initial.financeVersion ||
        c.encrypted !== initial.encrypted ||
        (c.historyStoreId && c.historyStoreId !== initial.storeId)
      )
        throw new ConflictException(
          "Подключение изменилось. Повторите сохранение ключа.",
        );
      c.historyStoreId = initial.storeId;
      c.historySellerId = sellerId;
      c.financeEncrypted = encrypted;
      c.financeVersion = (c.financeVersion ?? 0) + 1;
      await put(tx, "marketplace_connections", c.provider, c);
      for (const j of await loadHistoryJobs(tx))
        if (
          j.provider === "wildberries" &&
          j.storeId === c.historyStoreId &&
          j.status === "permission_required"
        ) {
          j.status = "queued";
          j.message =
            "История WB поставлена в очередь. Доступ проверится при загрузке.";
          await historyPut(tx, "forecast_history_jobs", j.id, j);
        }
      const response = await this._overview(tx);
      await tx.query(
        "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
        [b.requestId, initial.fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  private async _financePrevious(
    tx: Queryable,
    requestId: string,
    fingerprint: string,
  ) {
    if (
      (
        await tx.query(
          "SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1",
          [requestId],
        )
      ).rows.length
    )
      throw new ConflictException("requestId уже использован");
    const previous = (
      await tx.query<{
        fingerprint: string;
        response: D.ForecastHistoryOverviewDto;
      }>("SELECT fingerprint,response FROM commands WHERE request_id=$1", [
        requestId,
      ])
    ).rows[0];
    if (previous && previous.fingerprint !== fingerprint)
      throw new ConflictException("requestId уже использован");
    return previous?.response;
  }

  async startForecastHistory(
    b: D.StartForecastHistoryDto,
  ): Promise<D.ForecastHistoryOverviewDto> {
    if (
      validateSync(Object.assign(new D.StartForecastHistoryDto(), b), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length ||
      !validDate(b.from) ||
      !validDate(b.to) ||
      b.from < "2024-01-01" ||
      b.from > b.to ||
      b.to >= today()
    )
      throw new BadRequestException(
        "Укажите период с 2024 года до вчерашнего дня",
      );
    if (b.provider === "wildberries" && b.from < "2024-01-29")
      throw new BadRequestException(
        "Финансовая история WB доступна с 29 января 2024 года",
      );
    return this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true),
        fingerprint = createHash("sha256")
          .update(JSON.stringify(["forecast/startHistory", b, actor.id]))
          .digest("hex");
      if (
        (
          await tx.query(
            "SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1",
            [b.requestId],
          )
        ).rows.length
      )
        throw new ConflictException("requestId уже использован");
      const previous = (
        await tx.query<{
          fingerprint: string;
          response: D.ForecastHistoryOverviewDto;
        }>("SELECT fingerprint,response FROM commands WHERE request_id=$1", [
          b.requestId,
        ])
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException("requestId уже использован");
        return previous.response;
      }
      const m = await loadMarketplaces(tx),
        c = m.connections.find((c) => c.provider === b.provider);
      if (!c?.enabled) throw new BadRequestException("Подключите маркетплейс");
      c.historyStoreId = historyStore(c);
      await put(tx, "marketplace_connections", c.provider, c);
      const id = historyId(c.historyStoreId, b.from, b.to);
      const existing = (await loadHistoryJobs(tx)).find((j) => j.id === id);
      if (existing && existing.status === "paused") {
        existing.status =
          c.provider === "wildberries" && !c.financeEncrypted
            ? "permission_required"
            : "queued";
        existing.connectionVersion = c.version;
        existing.leaseId = null;
        existing.leaseUntil = null;
        existing.retryAt = null;
        existing.message = "Загрузка истории продолжится";
        await historyPut(tx, "forecast_history_jobs", id, existing);
      }
      if (!existing) {
        const now = new Date().toISOString(),
          job: HistoryJob = {
            id,
            provider: c.provider,
            storeId: c.historyStoreId,
            connectionVersion: c.version,
            from: b.from,
            to: b.to,
            monthFrom: b.from,
            monthTo: monthEnd(b.from, b.to),
            cursor: "",
            seenCursors: [],
            pages: 0,
            status:
              c.provider === "wildberries" && !c.financeEncrypted
                ? "permission_required"
                : "queued",
            leaseId: null,
            leaseUntil: null,
            retryAt: null,
            message:
              c.provider === "wildberries" && !c.financeEncrypted
                ? "Нужен подтверждённый доступ WB «Финансы». Текущие заказы продолжают сохраняться."
                : "История поставлена в очередь",
            createdAt: now,
            updatedAt: now,
          };
        await historyPut(tx, "forecast_history_jobs", id, job);
      }
      const response = await this._overview(tx);
      await tx.query(
        "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
        [b.requestId, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  /** An explicit completed backfill authorizes continuing this store's archive. No account/session is invented. */
  async maintainAuthorizedHistory(signal?: AbortSignal): Promise<number> {
    this._internal();
    if (signal?.aborted) return 0;
    const day = today(),
      through = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    return this.warehouse.authTransaction(async (tx) => {
      if (signal?.aborted) return 0;
      const m = await loadMarketplaces(tx);
      type MaintenanceJob = HistoryJob & {
        maintenanceDay?: string;
        parentJobId?: string;
      };
      const jobs = (await loadHistoryJobs(tx)) as MaintenanceJob[];
      let created = 0;
      for (const c of m.connections) {
        if (!c.enabled || !c.encrypted || !c.historyStoreId) continue;
        const scoped = jobs.filter(
          (j) => j.provider === c.provider && j.storeId === c.historyStoreId,
        );
        // A pending/paused/permission-gated explicit or maintenance job must be resumed, never bypassed.
        if (scoped.some((j) => j.status !== "complete")) continue;
        const explicit = scoped.filter(
          (j) => !j.maintenanceDay && j.status === "complete",
        );
        if (!explicit.length) continue;
        if (
          c.provider === "wildberries" &&
          (!c.financeEncrypted || !c.historySellerId)
        )
          continue;
        const latest = scoped
          .filter((j) => j.status === "complete")
          .sort((a, b) => b.to.localeCompare(a.to))[0];
        const latestUpdatedDay = new Date(
          Date.parse(latest.updatedAt) + 10800000,
        )
          .toISOString()
          .slice(0, 10);
        // Completing the initial import already checked today's requested range. Start recurring repair tomorrow.
        if (latestUpdatedDay >= day && latest.to >= through) continue;
        const id = historyId(
          c.historyStoreId,
          c.provider,
          "daily-maintenance",
          day,
        );
        if (scoped.some((j) => j.id === id)) continue;
        const authorization = explicit.sort((a, b) =>
          a.from.localeCompare(b.from),
        )[0];
        const rollingFrom = new Date(Date.parse(through) - 59 * 86400000)
          .toISOString()
          .slice(0, 10);
        const missingFrom = new Date(Date.parse(latest.to) + 86400000)
          .toISOString()
          .slice(0, 10);
        const desired = missingFrom < rollingFrom ? missingFrom : rollingFrom;
        const from =
          desired < authorization.from ? authorization.from : desired;
        if (from > through) continue;
        const now = new Date().toISOString();
        const job: MaintenanceJob = {
          id,
          provider: c.provider,
          storeId: c.historyStoreId,
          connectionVersion: c.version,
          from,
          to: through,
          monthFrom: from,
          monthTo: monthEnd(from, through),
          cursor: "",
          seenCursors: [],
          pages: 0,
          status: "queued",
          leaseId: null,
          leaseUntil: null,
          retryAt: null,
          message: "Обновляем недавнюю историю и поздние исправления",
          createdAt: now,
          updatedAt: now,
          maintenanceDay: day,
          parentJobId: authorization.id,
        };
        await historyPut(tx, "forecast_history_jobs", id, job);
        jobs.push(job);
        created++;
      }
      return created;
    });
  }
  async bootstrap() {
    this._internal();
    await this.warehouse.authTransaction(async (tx) => {
      const m = await loadMarketplaces(tx);
      await bootstrapForecastHistory(tx, m.connections, m.snapshots);
    });
  }
  /** One page per tick; no upstream call while holding the SQL lock. */
  async runNextHistoryPage(signal?: AbortSignal) {
    this._internal();
    if (signal?.aborted) return "skipped";
    const now = Date.now(),
      slot = Math.floor(now / 1800000) * 1800000;
    if (slot + 1800000 - now < 240000) return "skipped";
    const claim = await this.warehouse.authTransaction(async (tx) => {
      if (signal?.aborted) return;
      const m = await loadMarketplaces(tx);
      if (
        m.connections.some(
          (c) =>
            c.enabled &&
            ((c.syncStatus === "running" &&
              Date.now() - Date.parse(c.lastAttemptAt ?? "") <
                MARKETPLACE_RUN_LEASE_MS) ||
              Date.parse(c.lastAttemptAt ?? "") < slot ||
              !c.lastAttemptAt),
        )
      )
        return;
      const jobs = await loadHistoryJobs(tx);
      jobs.sort((a, b) => {
        const maintenancePriority =
          Number(
            !!(a as HistoryJob & { maintenanceDay?: string }).maintenanceDay,
          ) -
          Number(
            !!(b as HistoryJob & { maintenanceDay?: string }).maintenanceDay,
          );
        // One page at a time, oldest waiting job first: a large catalog cannot starve the other store.
        return (
          maintenancePriority ||
          a.updatedAt.localeCompare(b.updatedAt) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id)
        );
      });
      for (const j of jobs) {
        if (
          !["queued", "running", "failed"].includes(j.status) ||
          (j.retryAt && Date.parse(j.retryAt) > Date.now()) ||
          (j.leaseUntil && Date.parse(j.leaseUntil) > Date.now())
        )
          continue;
        const c = m.connections.find(
          (c) => c.provider === j.provider && c.historyStoreId === j.storeId,
        );
        if (!c?.enabled || !c.encrypted) continue;
        if (j.provider === "wildberries" && !c.financeEncrypted) {
          j.status = "permission_required";
          j.message = "Нужен доступ к финансовой истории WB";
          await historyPut(tx, "forecast_history_jobs", j.id, j);
          continue;
        }
        if (c.historyLease && Date.parse(c.historyLease.until) > Date.now())
          continue;
        j.connectionVersion = c.version;
        j.status = "running";
        j.leaseId = randomUUID();
        j.leaseUntil = new Date(
          Date.now() + PAGE_TIMEOUT + 15000,
        ).toISOString();
        j.updatedAt = new Date().toISOString();
        j.message = "Загружается история заказов";
        c.historyLease = { runId: j.leaseId, until: j.leaseUntil };
        await put(tx, "marketplace_connections", c.provider, c);
        await historyPut(tx, "forecast_history_jobs", j.id, j);
        return { job: j, connection: c };
      }
      return;
    });
    if (!claim) return "skipped";
    let page: Awaited<ReturnType<typeof fetchOzonHistoryPage>> | undefined;
    let failed = false;
    let permissionRequired = false;
    const scoped = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT)])
      : AbortSignal.timeout(PAGE_TIMEOUT);
    try {
      const credentials = await this.secrets.decrypt<MarketplaceCredentials>(
        claim.job.provider === "wildberries"
          ? claim.connection.financeEncrypted!
          : claim.connection.encrypted,
        claim.job.provider === "wildberries"
          ? `forecast-finance:${claim.job.storeId}`
          : claim.connection.provider,
      );
      scoped.throwIfAborted();
      page = await (
        claim.job.provider === "wildberries"
          ? this.fetchFinancePage
          : this.fetchPage
      )(credentials, claim.job, { signal: scoped });
      scoped.throwIfAborted();
    } catch (error) {
      failed = true;
      permissionRequired =
        claim.job.provider === "wildberries" &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "credentials";
    }
    return this.warehouse.authTransaction(async (tx) => {
      const c = (await loadMarketplaces(tx)).connections.find(
          (c) => c.provider === claim.connection.provider,
        ),
        j = (await loadHistoryJobs(tx)).find((j) => j.id === claim.job.id);
      if (!j || j.leaseId !== claim.job.leaseId) return "superseded";
      const own = c?.historyLease?.runId === claim.job.leaseId;
      const valid =
        c?.enabled &&
        c.version === claim.connection.version &&
        c.financeVersion === claim.connection.financeVersion &&
        c.historyStoreId === claim.job.storeId &&
        own;
      if (own) {
        delete c.historyLease;
        await put(tx, "marketplace_connections", c.provider, c);
      }
      j.leaseId = null;
      j.leaseUntil = null;
      j.updatedAt = new Date().toISOString();
      if (!valid) {
        j.status = "paused";
        j.message =
          "Подключение изменилось. Запустите загрузку для текущего магазина.";
      } else if (signal?.aborted) {
        j.status = "queued";
        j.message = "История продолжится после запуска сервера";
      } else if (permissionRequired) {
        j.status = "permission_required";
        j.retryAt = null;
        j.message =
          "Ключ WB не даёт доступа к финансовой истории. Проверьте права «Финансы».";
      } else if (failed || !page) {
        j.status = "failed";
        j.retryAt = new Date(Date.now() + 1800000).toISOString();
        j.message = "Не удалось получить страницу. Повторим автоматически.";
      } else {
        const stagedFacts: HistoryFact[] = [];
        for (const f of page.facts) {
          if (
            !validDate(f.date) ||
            (j.provider === "ozon" &&
              (f.date < j.monthFrom || f.date > j.monthTo)) ||
            !Number.isSafeInteger(f.units) ||
            f.units < 0 ||
            !(
              j.provider === "ozon"
                ? ["ordered", "cancelled"]
                : ["sold", "returned"]
            ).includes(f.metric) ||
            f.source !== (j.provider === "ozon" ? "ozon_fbo" : "wb_finance")
          )
            throw new Error("Invalid historical fact");
          const fact: HistoryFact = {
            ...f,
            id: historyId(j.storeId, f.id),
            storeId: j.storeId,
            provider: j.provider,
            observedAt: j.updatedAt,
          };
          stagedFacts.push(fact);
        }
        await historyPut(
          tx,
          "forecast_history_pages",
          historyId(j.id, j.monthFrom, j.cursor),
          {
            jobId: j.id,
            monthFrom: j.monthFrom,
            storeId: j.storeId,
            facts: stagedFacts,
          },
        );
        j.pages++;
        j.retryAt =
          j.provider === "wildberries"
            ? new Date(Date.now() + 61000).toISOString()
            : null;
        if (page.cursor) {
          if (
            j.seenCursors.includes(page.cursor) ||
            j.cursor === page.cursor ||
            j.pages > 100000
          )
            throw new Error("Invalid history cursor");
          j.seenCursors.push(page.cursor);
          j.cursor = page.cursor;
          j.status = "queued";
        } else {
          const completedPages = (
            await tx.query<{ payload: { facts: HistoryFact[] } }>(
              "SELECT payload FROM forecast_history_pages WHERE payload->>'jobId'=$1 AND payload->>'monthFrom'=$2 ORDER BY id",
              [j.id, j.monthFrom],
            )
          ).rows;
          // A fully reloaded order month is authoritative, including removed
          // postings. Keep other sources, accounts and months untouched.
          // Finance report windows are not sale-date windows and cannot use
          // this replacement rule.
          if (j.provider === "ozon")
            await tx.query(
              "DELETE FROM forecast_history_facts WHERE payload->>'storeId'=$1 AND payload->>'source'=$2 AND payload->>'date'>=$3 AND payload->>'date'<=$4",
              [j.storeId, "ozon_fbo", j.monthFrom, j.monthTo],
            );
          for (const part of completedPages)
            for (const fact of part.payload.facts)
              await historyPut(tx, "forecast_history_facts", fact.id, fact);
          await tx.query(
            "DELETE FROM forecast_history_pages WHERE payload->>'jobId'=$1 AND payload->>'monthFrom'=$2",
            [j.id, j.monthFrom],
          );
          await bumpForecastHistoryRevision(tx);
          if (j.provider === "ozon") {
            const coverage: HistoryCoverage = {
              storeId: j.storeId,
              provider: j.provider,
              from: j.monthFrom,
              to: j.monthTo,
              source: "ozon_fbo",
              observedAt: j.updatedAt,
            };
            await historyPut(
              tx,
              "forecast_history_coverage",
              historyId(j.storeId, "ozon_fbo", j.monthFrom, j.monthTo),
              coverage,
            );
          }
          if (j.monthTo === j.to) {
            j.status = "complete";
            j.message =
              "Доступная история загружена. Пустые месяцы не подтверждают наличие товара.";
          } else {
            j.monthFrom = new Date(Date.parse(j.monthTo) + 86400000)
              .toISOString()
              .slice(0, 10);
            j.monthTo = monthEnd(j.monthFrom, j.to);
            j.cursor = "";
            j.seenCursors = [];
            j.status = "queued";
          }
        }
      }
      await historyPut(tx, "forecast_history_jobs", j.id, j);
      return j.status;
    });
  }
}
