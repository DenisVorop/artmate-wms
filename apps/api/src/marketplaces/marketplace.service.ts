import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { validateSync } from "class-validator";
import { WarehouseService } from "../warehouse.service";
import { Queryable } from "../database";
import { requireAuth } from "../auth-policy";
import * as D from "./dto";
import { Connection, loadMarketplaces, put, MarketplaceState } from "./storage";
import { MarketplaceSecrets } from "./secrets";
import { marketplacePlan } from "./planning";
import {
  fetchMarketplaceSnapshot,
  MarketplaceProviderError,
} from "./providers";
import {
  MarketplaceCredentials,
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "./providers/types";
type FetchSnapshot = typeof fetchMarketplaceSnapshot;
@Injectable()
export class MarketplaceService {
  private readonly secrets: MarketplaceSecrets;
  private readonly fetchSnapshot: FetchSnapshot;
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {
    this.secrets = new MarketplaceSecrets();
    this.fetchSnapshot = fetchMarketplaceSnapshot;
  }
  // Explicit injection for isolated tests: production never accepts an endpoint or fetch function from HTTP.
  static forTesting(
    warehouse: WarehouseService,
    secrets: MarketplaceSecrets,
    fetchSnapshot: FetchSnapshot,
  ) {
    const service = new MarketplaceService(warehouse);
    Object.assign(service, { secrets, fetchSnapshot });
    return service;
  }
  private async _manager(tx: Queryable, write = false) {
    const a = await requireAuth(tx, write);
    if (a.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
    return a;
  }
  private _validate<T extends object>(type: new () => T, body: T) {
    const errors = validateSync(Object.assign(new type(), body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException("Проверьте параметры интеграции");
  }
  private async _fingerprint(
    operation: string,
    body: unknown,
    actor: string,
    secret = false,
  ) {
    const data = [`marketplaces/${operation}`, body, actor];
    return secret
      ? this.secrets.fingerprint(data)
      : createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }
  private async _previous<T>(
    tx: Queryable,
    requestId: string,
    fingerprint: string,
  ): Promise<T | undefined> {
    if (
      (
        await tx.query(
          "SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1",
          [requestId],
        )
      ).rows.length
    )
      throw new ConflictException(
        "Этот requestId уже использован для другой операции",
      );
    const p = await tx.query<{ fingerprint: string; response: T }>(
      "SELECT fingerprint,response FROM commands WHERE request_id=$1",
      [requestId],
    );
    if (p.rows[0] && p.rows[0].fingerprint !== fingerprint)
      throw new ConflictException(
        "Этот requestId уже использован для другой операции",
      );
    return p.rows[0]?.response;
  }
  private async _cache(
    tx: Queryable,
    id: string,
    fingerprint: string,
    response: unknown,
  ) {
    await tx.query(
      "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
      [id, fingerprint, JSON.stringify(response)],
    );
  }
  private async _overview(tx: Queryable): Promise<D.MarketplaceOverviewDto> {
    const m = await loadMarketplaces(tx),
      w = await this.warehouse.stocktakeState(tx);
    return {
      connections: D.MARKETPLACE_PROVIDERS.map((provider) => {
        const c = m.connections.find((x) => x.provider === provider);
        return {
          provider,
          configured: !!c,
          enabled: c?.enabled ?? false,
          clientId: c?.clientId ?? null,
          syncStatus: c?.syncStatus ?? "never",
          lastSuccessAt: c?.lastSuccessAt ?? null,
          lastAttemptAt: c?.lastAttemptAt ?? null,
          message: c?.message ?? null,
          warnings: c?.warnings ?? [],
        };
      }),
      supplies: m.snapshots.flatMap((snapshot) =>
        (snapshot.supplies ?? []).map((supply) => ({
          ...supply,
          provider: snapshot.provider,
          items: supply.items.map((item) => {
            const mapping = m.mappings.find(
              (entry) =>
                entry.provider === snapshot.provider &&
                entry.externalId === item.externalId,
            );
            return { ...item, skuId: mapping?.skuId ?? null };
          }),
        })),
      ),
      products: m.snapshots.flatMap((s) =>
        s.products.map((p) => {
          const map = m.mappings.find(
              (x) => x.provider === s.provider && x.externalId === p.externalId,
            ),
            matching = w.skus.filter((sku) => p.barcodes.includes(sku.barcode));
          return {
            provider: s.provider,
            externalId: p.externalId,
            offerId: p.offerId ?? null,
            name: p.name,
            barcodes: p.barcodes,
            skuId: map?.skuId ?? null,
            unitsPerItem: map?.unitsPerItem ?? 1,
            suggestedSkuId: matching.length === 1 ? matching[0].id : null,
          };
        }),
      ),
      settings: m.settings,
      plan: marketplacePlan(w, m),
    };
  }
  async getMarketplaces() {
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      return this._overview(tx);
    });
  }
  private async _command<T extends D.MarketplaceCommandDto>(
    operation: string,
    type: new () => T,
    b: T,
    mutate: (tx: Queryable, m: MarketplaceState) => Promise<void>,
    secret = false,
  ) {
    this._validate(type, b);
    return this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true),
        fp = await this._fingerprint(operation, b, actor.id, secret),
        cached = await this._previous<D.MarketplaceOverviewDto>(
          tx,
          b.requestId,
          fp,
        );
      if (cached) return cached;
      await mutate(tx, await loadMarketplaces(tx));
      const response = await this._overview(tx);
      await this._cache(tx, b.requestId, fp, response);
      return response;
    });
  }
  connectMarketplace(b: D.ConnectMarketplaceDto) {
    return this._command(
      "connectMarketplace",
      D.ConnectMarketplaceDto,
      b,
      async (tx, m) => {
        if (b.provider === "ozon" && !b.clientId?.trim())
          throw new BadRequestException("Укажите Client-Id Ozon");
        const old = m.connections.find((c) => c.provider === b.provider),
          credentials: MarketplaceCredentials = {
            apiKey: b.apiKey.trim(),
            ...(b.provider === "ozon" ? { clientId: b.clientId!.trim() } : {}),
          };
        if (!credentials.apiKey)
          throw new BadRequestException("Введите API-ключ");
        const connection: Connection = {
          provider: b.provider,
          encrypted: await this.secrets.encrypt(credentials, b.provider),
          clientId: credentials.clientId ?? null,
          enabled: true,
          version: (old?.version ?? 0) + 1,
          syncStatus: "never",
          lastAttemptAt: null,
          lastSuccessAt: old?.lastSuccessAt ?? null,
          message: "Ключ сохранён. Выполните загрузку данных.",
          warnings: [],
          runId: null,
        };
        await put(tx, "marketplace_connections", b.provider, connection);
        await tx.query("DELETE FROM marketplace_transit");
        // A replacement key may belong to another seller account. Require mappings to be confirmed again.
        await tx.query(
          "DELETE FROM marketplace_mappings WHERE payload->>'provider'=$1",
          [b.provider],
        );
      },
      true,
    );
  }
  toggleMarketplace(b: D.ToggleMarketplaceDto) {
    return this._command(
      "toggleMarketplace",
      D.ToggleMarketplaceDto,
      b,
      async (tx, m) => {
        const c = this._connection(m, b.provider);
        c.enabled = b.enabled;
        c.version++;
        c.runId = null;
        if (c.syncStatus === "running")
          c.syncStatus = c.lastSuccessAt ? "partial" : "never";
        await put(tx, "marketplace_connections", c.provider, c);
        await tx.query("DELETE FROM marketplace_transit");
      },
    );
  }
  mapMarketplaceProduct(b: D.MapMarketplaceProductDto) {
    return this._command(
      "mapMarketplaceProduct",
      D.MapMarketplaceProductDto,
      b,
      async (tx, m) => {
        if (
          !m.snapshots.some(
            (s) =>
              s.provider === b.provider &&
              s.products.some((p) => p.externalId === b.externalId),
          )
        )
          throw new BadRequestException("Сначала загрузите эту карточку");
        const w = await this.warehouse.stocktakeState(tx);
        if (!w.skus.some((s) => s.id === b.skuId))
          throw new BadRequestException("Тематика не найдена");
        await put(
          tx,
          "marketplace_mappings",
          JSON.stringify([b.provider, b.externalId]),
          {
            provider: b.provider,
            externalId: b.externalId,
            skuId: b.skuId,
            unitsPerItem: b.unitsPerItem,
          },
        );
      },
    );
  }
  updateMarketplaceSettings(b: D.UpdateMarketplaceSettingsDto) {
    return this._command(
      "updateMarketplaceSettings",
      D.UpdateMarketplaceSettingsDto,
      b,
      async (tx) => {
        const { requestId, ...settings } = b;
        await put(tx, "marketplace_settings", "common", settings);
      },
    );
  }
  setMarketplaceTransit(b: D.SetMarketplaceTransitDto) {
    return this._command(
      "setMarketplaceTransit",
      D.SetMarketplaceTransitDto,
      b,
      async (tx) => {
        const w = await this.warehouse.stocktakeState(tx);
        if (!w.skus.some((s) => s.id === b.skuId))
          throw new BadRequestException("Тематика не найдена");
        await put(tx, "marketplace_transit", b.skuId, {
          skuId: b.skuId,
          units: b.inTransitUnits,
        });
      },
    );
  }
  private _connection(m: MarketplaceState, provider: MarketplaceProvider) {
    const c = m.connections.find((c) => c.provider === provider);
    if (!c) throw new BadRequestException("Сначала подключите маркетплейс");
    return c;
  }
  async syncMarketplace(
    b: D.SyncMarketplaceDto,
  ): Promise<D.MarketplaceOverviewDto> {
    this._validate(D.SyncMarketplaceDto, b);
    const start = await this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true),
        fp = await this._fingerprint("syncMarketplace", b, actor.id),
        cached = await this._previous<
          D.MarketplaceOverviewDto | { marketplacePending: true; runId: string }
        >(tx, b.requestId, fp);
      if (cached) {
        if ("marketplacePending" in cached)
          throw new ConflictException(
            "Загрузка уже запущена. Обновите страницу.",
          );
        return { cached };
      }
      const loaded = await loadMarketplaces(tx),
        c = this._connection(loaded, b.provider);
      if (!c.enabled) throw new BadRequestException("Маркетплейс отключён");
      if (
        c.syncStatus === "running" &&
        c.lastAttemptAt &&
        Date.now() - Date.parse(c.lastAttemptAt) < 5 * 60000
      )
        throw new ConflictException("Загрузка уже выполняется");
      const credentials = await this.secrets.decrypt<MarketplaceCredentials>(
          c.encrypted,
          c.provider,
        ),
        runId = randomUUID();
      c.syncStatus = "running";
      c.runId = runId;
      c.lastAttemptAt = new Date().toISOString();
      c.message = null;
      await put(tx, "marketplace_connections", c.provider, c);
      await this._cache(tx, b.requestId, fp, {
        marketplacePending: true,
        runId,
      });
      return {
        credentials,
        runId,
        version: c.version,
        fp,
        historyDays: b.historyDays ?? loaded.settings.historyDays,
      };
    });
    if (start.cached) return start.cached;
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10),
      to = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10),
      from = new Date(Date.parse(to) - (start.historyDays! - 1) * 86400000)
        .toISOString()
        .slice(0, 10);
    let snapshot: MarketplaceSnapshot | undefined;
    let failureMessage =
      "Загрузка не удалась. Повторите позже. Предыдущая полная загрузка сохранена.";
    try {
      snapshot = await this.fetchSnapshot(
        b.provider,
        start.credentials!,
        { from, to },
        { signal: AbortSignal.timeout(240000) },
      );
    } catch (error) {
      // Only our fixed messages are safe; provider bodies and arbitrary error messages may contain secrets.
      if (error instanceof MarketplaceProviderError) {
        const messages: Record<MarketplaceProviderError["code"], string> = {
          credentials:
            "Маркетплейс отклонил ключ или его права. Проверьте настройки подключения.",
          rate_limit:
            "Достигнут лимит запросов маркетплейса. Повторите загрузку позже.",
          unavailable:
            "Маркетплейс временно недоступен. Повторите загрузку позже.",
          invalid_response:
            "Маркетплейс вернул неожиданные или неполные данные. Предыдущая загрузка сохранена.",
          limit:
            "Превышен допустимый период или объём загрузки. Уменьшите период.",
          aborted: "Загрузка превысила время ожидания. Повторите позже.",
        };
        failureMessage = messages[error.code];
        // Only transport-owned scalar diagnostics; never log the exception, body or headers.
        if (error.diagnostic) {
          const { operation, status, attempt, retryAfterSeconds } =
            error.diagnostic;
          console.warn("Marketplace import failed", {
            provider: b.provider,
            code: error.code,
            operation,
            status,
            attempt,
            retryAfterSeconds,
          });
        }
      }
    }
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx, true);
      const c = this._connection(await loadMarketplaces(tx), b.provider);
      if (c.version !== start.version || c.runId !== start.runId || !c.enabled)
        throw new ConflictException(
          "Настройки подключения изменились. Повторите загрузку.",
        );
      const complete =
        !!snapshot &&
        snapshot.provider === b.provider &&
        snapshot.coverage.catalog &&
        snapshot.coverage.stocks &&
        snapshot.coverage.demand;
      c.runId = null;
      c.syncStatus = complete ? "success" : snapshot ? "partial" : "failed";
      c.message = complete
        ? "Данные загружены"
        : snapshot
          ? "Получены неполные данные. Сохранена последняя полная загрузка."
          : failureMessage;
      c.warnings = complete ? snapshot!.warnings : [];
      if (complete) {
        c.lastSuccessAt = new Date().toISOString();
        await put(tx, "marketplace_snapshots", c.provider, snapshot);
        await tx.query("DELETE FROM marketplace_transit");
      }
      await put(tx, "marketplace_connections", c.provider, c);
      const response = await this._overview(tx);
      await tx.query(
        "UPDATE commands SET response=$1 WHERE request_id=$2 AND fingerprint=$3",
        [JSON.stringify(response), b.requestId, start.fp],
      );
      return response;
    });
  }
  async createMarketplaceTask(
    b: D.CreateMarketplaceTaskDto,
  ): Promise<D.MarketplaceTaskResultDto> {
    this._validate(D.CreateMarketplaceTaskDto, b);
    return this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true),
        fp = await this._fingerprint("createMarketplaceTask", b, actor.id),
        cached = await this._previous<D.MarketplaceTaskResultDto>(
          tx,
          b.requestId,
          fp,
        );
      if (cached) return cached;
      const state = await this.warehouse.stocktakeState(tx),
        marketplace = await loadMarketplaces(tx),
        plan = marketplacePlan(state, marketplace),
        row = plan.rows.find((r) => r.skuId === b.skuId);
      if (!row || row.proposalHash !== b.proposalHash)
        throw new ConflictException("Расчёт устарел. Обновите рекомендации.");
      if (!row.canCreate)
        throw new BadRequestException(row.blockers.join(". "));
      const taskId = await this.warehouse.commitPlanningTask(
        tx,
        structuredClone(state),
        state,
        {
          requestId: b.requestId,
          skuId: b.skuId,
          boxesTarget: row.recommendedBoxes,
        },
      );
      await put(tx, "marketplace_task_origins", taskId, {
        taskId,
        skuId: b.skuId,
        sourceType: "forecast",
        proposalHash: b.proposalHash,
        createdAt: new Date().toISOString(),
        actorAccountId: actor.id,
        recommendedBoxes: row.recommendedBoxes,
        settings: marketplace.settings,
        calculation: row,
        sources: marketplace.snapshots
          .filter((snapshot) =>
            marketplace.connections.some(
              (c) => c.enabled && c.provider === snapshot.provider,
            ),
          )
          .map((snapshot) => ({
            provider: snapshot.provider,
            asOf: snapshot.asOf,
            from: snapshot.from,
            to: snapshot.to,
          })),
      });
      const response = { taskId, overview: await this._overview(tx) };
      await this._cache(tx, b.requestId, fp, response);
      return response;
    });
  }
}
