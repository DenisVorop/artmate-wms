import { readForecastPlanContext } from "../forecasting/forecast-storage";
import {
  Inject,
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { plainToInstance } from "class-transformer";
import {
  activeMarketplaceResolutions,
  applyMarketplaceResolutions,
  marketplaceResolutionId,
  saveMarketplaceResolution,
  supersedePositiveStockResolutions,
  type MarketplaceResolution,
} from "./planning-resolutions";
import { validateSync } from "class-validator";
import { WarehouseService } from "../warehouse.service";
import { Queryable } from "../database";
import { requireAuth } from "../auth-policy";
import { requestAuth } from "../auth-context";
import * as D from "./dto";
import { Connection, loadMarketplaces, put, MarketplaceState } from "./storage";
import { MarketplaceSecrets } from "./secrets";
import { marketplacePlan } from "./planning";
import { readPlanningPresentation } from "./planning-presentation";
import {
  fetchMarketplaceSnapshot,
  MarketplaceProviderError,
} from "./providers";
import {
  MarketplaceCredentials,
  MarketplaceProvider,
  MarketplaceSnapshot,
} from "./providers/types";
import {
  MARKETPLACE_RUN_LEASE_MS,
  MARKETPLACE_RUN_TIMEOUT_MS,
} from "./providers/request-policy";
import {
  archiveMarketplaceSnapshot,
  historyStore,
} from "../forecasting/history-storage";
import { fetchWbSellerId } from "../forecasting/history-providers";
type FetchSnapshot = typeof fetchMarketplaceSnapshot;
@Injectable()
export class MarketplaceService {
  private readonly secrets: MarketplaceSecrets;
  private readonly fetchSnapshot: FetchSnapshot;
  private readonly fetchSellerId = fetchWbSellerId;
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
    fetchSellerId: typeof fetchWbSellerId = async () => {
      throw new Error("A test seller identity resolver is required");
    },
  ) {
    const service = new MarketplaceService(warehouse);
    Object.assign(service, { secrets, fetchSnapshot, fetchSellerId });
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
          "SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM automation_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM pallet_label_commands WHERE request_id=$1",
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
    const clock = new Date(),
      forecast = await readForecastPlanContext(tx, m, clock),
      plan = marketplacePlan(w, m, clock, forecast),
      presentation = await readPlanningPresentation(
        tx,
        w,
        m,
        clock,
        forecast,
        plan,
      );
    const applied = applyMarketplaceResolutions(m, clock),
      activeResolutionIds = new Set(
        activeMarketplaceResolutions(m, clock).map((r) => r.id),
      );
    return {
      resolutions: (m.resolutions ?? [])
        .filter((r) => {
          const connection = m.connections.find(
            (c) => c.provider === r.provider,
          );
          return (
            connection?.historyStoreId === r.storeId &&
            connection.version === r.connectionVersion
          );
        })
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          provider: r.provider,
          externalId: r.externalId ?? null,
          supplyId: r.supplyId ?? null,
          skuId: r.skuId ?? null,
          enabled: r.enabled,
          active: activeResolutionIds.has(r.id),
          note: r.note,
          donorProvider: r.donorProvider ?? null,
          confirmedAt: r.confirmedAt,
          expiresAt: r.expiresAt,
          revision: r.revision,
        })),
      planningStock: [],
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
      supplies: applied.snapshots.flatMap((snapshot) =>
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
      plan,
      ...presentation,
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
  setMarketplaceResolution(body: D.SetMarketplaceResolutionDto) {
    return this._command(
      "setMarketplaceResolution",
      D.SetMarketplaceResolutionDto,
      body,
      async (tx, m) => {
        const actor = await this._manager(tx, true),
          connection = m.connections.find((c) => c.provider === body.provider),
          snapshot = m.snapshots.find((s) => s.provider === body.provider),
          note = body.note.trim();
        if (!note) throw new BadRequestException("Укажите причину уточнения");
        if (!body.enabled) {
          if (!connection?.historyStoreId)
            throw new ConflictException("Действующий магазин не определён");
          if (
            body.kind === "exclude_supply"
              ? !body.supplyId || !!body.externalId || !!body.donorProvider
              : !body.externalId || !!body.supplyId
          )
            throw new BadRequestException("Выберите существующее уточнение");
          const id = marketplaceResolutionId({
            provider: body.provider,
            storeId: connection.historyStoreId,
            kind: body.kind,
            externalId: body.externalId,
            supplyId: body.supplyId,
          });
          const previous = m.resolutions?.find(
            (entry) =>
              entry.id === id &&
              entry.provider === body.provider &&
              entry.storeId === connection.historyStoreId &&
              entry.kind === body.kind,
          );
          if (
            !previous ||
            (body.donorProvider !== undefined &&
              body.donorProvider !== previous.donorProvider)
          )
            throw new BadRequestException(
              "Уточнение не найдено в действующем магазине",
            );
          // Undo an existing decision even if its document, mapping or donor has disappeared.
          // Keep the original account/version/expiry binding; disabling never creates a new fact.
          const current: MarketplaceResolution = {
            ...previous,
            enabled: false,
            note,
            actorAccountId: actor.id,
            revision: previous.revision + 1,
          };
          await saveMarketplaceResolution(tx, current);
          await tx.query(
            "INSERT INTO marketplace_resolution_events(id,payload) VALUES($1,$2)",
            [
              body.requestId,
              JSON.stringify({
                requestId: body.requestId,
                actorAccountId: actor.id,
                recordedAt: new Date().toISOString(),
                previous,
                current,
              }),
            ],
          );
          return;
        }
        if (
          !connection?.enabled ||
          !connection.historyStoreId ||
          connection.lastSuccessVersion !== connection.version ||
          !snapshot
        )
          throw new ConflictException(
            "Сначала загрузите данные действующего магазина",
          );
        let skuId: string | undefined;
        if (body.kind === "exclude_supply") {
          if (
            body.provider !== "wildberries" ||
            !body.supplyId ||
            body.externalId ||
            body.donorProvider
          )
            throw new BadRequestException("Выберите поставку WB");
          const supply = snapshot.supplies?.find((s) => s.id === body.supplyId);
          if (!supply || !supply.items.length)
            throw new BadRequestException(
              "Поставка не найдена в действующем магазине",
            );
        } else {
          if (
            !body.externalId ||
            body.supplyId ||
            !snapshot.products.some((p) => p.externalId === body.externalId)
          )
            throw new BadRequestException(
              "Выберите товар действующего магазина",
            );
          const mapping = m.mappings.find(
            (map) =>
              map.provider === body.provider &&
              map.externalId === body.externalId,
          );
          if (!mapping)
            throw new BadRequestException("Сначала свяжите товар с тематикой");
          skuId = mapping.skuId;
          if (body.kind === "zero_stock") {
            if (body.donorProvider)
              throw new BadRequestException("Источник прогноза здесь не нужен");
            if (
              body.enabled &&
              snapshot.stocks.some(
                (stock) =>
                  stock.externalId === body.externalId &&
                  stock.availableUnits !== null &&
                  stock.availableUnits > 0,
              )
            )
              throw new ConflictException(
                "API уже подтвердил товар на складе. Нулевой остаток не применяется.",
              );
          } else {
            const donor = m.connections.find(
              (c) => c.provider === body.donorProvider,
            );
            if (
              !body.donorProvider ||
              body.donorProvider === body.provider ||
              !donor?.enabled ||
              !donor.historyStoreId ||
              donor.lastSuccessVersion !== donor.version ||
              !m.mappings.some(
                (map) =>
                  map.provider === body.donorProvider &&
                  map.skuId === skuId &&
                  m.snapshots.some(
                    (s) =>
                      s.provider === map.provider &&
                      s.products.some((p) => p.externalId === map.externalId),
                  ),
              )
            )
              throw new BadRequestException(
                "Для прогноза запуска нужен тот же товар на другой площадке",
              );
          }
        }
        const id = marketplaceResolutionId({
            provider: body.provider,
            storeId: connection.historyStoreId,
            kind: body.kind,
            externalId: body.externalId,
            supplyId: body.supplyId,
          }),
          previous = m.resolutions?.find((r) => r.id === id) ?? null,
          current: MarketplaceResolution = {
            id,
            kind: body.kind,
            provider: body.provider,
            storeId: connection.historyStoreId,
            connectionVersion: connection.version,
            externalId: body.externalId,
            supplyId: body.supplyId,
            skuId,
            enabled: body.enabled,
            note,
            donorProvider: body.donorProvider,
            donorStoreId:
              body.kind === "launch"
                ? m.connections.find((c) => c.provider === body.donorProvider)
                    ?.historyStoreId
                : undefined,
            donorConnectionVersion:
              body.kind === "launch"
                ? m.connections.find((c) => c.provider === body.donorProvider)
                    ?.version
                : undefined,
            confirmedAt: new Date().toISOString(),
            expiresAt:
              body.kind === "zero_stock"
                ? new Date(Date.now() + 7 * 86_400_000).toISOString()
                : null,
            actorAccountId: actor.id,
            revision: (previous?.revision ?? 0) + 1,
          };
        await saveMarketplaceResolution(tx, current);
        await tx.query(
          "INSERT INTO marketplace_resolution_events(id,payload) VALUES($1,$2)",
          [
            body.requestId,
            JSON.stringify({
              requestId: body.requestId,
              actorAccountId: actor.id,
              recordedAt: current.confirmedAt,
              previous,
              current,
            }),
          ],
        );
      },
    );
  }
  async connectMarketplace(b: D.ConnectMarketplaceDto) {
    this._validate(D.ConnectMarketplaceDto, b);
    if (b.provider === "ozon" && !b.clientId?.trim())
      throw new BadRequestException("Укажите Client-Id Ozon");
    const credentials: MarketplaceCredentials = {
      apiKey: b.apiKey.trim(),
      ...(b.provider === "ozon" ? { clientId: b.clientId!.trim() } : {}),
    };
    if (!credentials.apiKey) throw new BadRequestException("Введите API-ключ");
    const initial = await this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true),
        fp = await this._fingerprint("connectMarketplace", b, actor.id, true),
        cached = await this._previous<D.MarketplaceOverviewDto>(
          tx,
          b.requestId,
          fp,
        );
      if (cached) return { cached };
      const old = (await loadMarketplaces(tx)).connections.find(
        (c) => c.provider === b.provider,
      );
      return { actorId: actor.id, old };
    });
    if ("cached" in initial) return initial.cached!;
    let sameWbSeller = false;
    let candidateSellerId: string | undefined;
    // Only an established trusted SID can preserve a WB archive. Identity
    // requests happen outside SQL, and an unavailable old key never silently
    // reassigns that archive to a replacement credential.
    if (b.provider === "wildberries" && initial.old?.historySellerId) {
      const signal = AbortSignal.timeout(180_000);
      try {
        const currentCredentials =
          await this.secrets.decrypt<MarketplaceCredentials>(
            initial.old.encrypted,
            "wildberries",
          );
        const currentSellerId = await this.fetchSellerId(currentCredentials, {
          signal,
        });
        candidateSellerId = await this.fetchSellerId(credentials, { signal });
        if (currentSellerId !== initial.old.historySellerId)
          throw new Error("Stored seller identity changed");
        sameWbSeller = currentSellerId === candidateSellerId;
        signal.throwIfAborted();
      } catch {
        throw new BadRequestException(
          "Не удалось проверить магазин WB. Текущий ключ и архив сохранены; повторите замену позже.",
        );
      }
    }
    return this._command(
      "connectMarketplace",
      D.ConnectMarketplaceDto,
      b,
      async (tx, m) => {
        const actor = await this._manager(tx, true);
        if (actor.id !== initial.actorId)
          throw new ForbiddenException("Сессия изменилась. Войдите снова");
        const old = m.connections.find((c) => c.provider === b.provider);
        if (
          old?.version !== initial.old?.version ||
          old?.encrypted !== initial.old?.encrypted ||
          old?.historyStoreId !== initial.old?.historyStoreId ||
          old?.historySellerId !== initial.old?.historySellerId ||
          old?.financeVersion !== initial.old?.financeVersion
        )
          throw new ConflictException(
            "Подключение изменилось. Повторите сохранение ключа.",
          );
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
        connection.historyStoreId =
          sameWbSeller ||
          (b.provider === "ozon" && old?.clientId === connection.clientId)
            ? old?.historyStoreId
            : undefined;
        connection.historyStoreId = historyStore(connection);
        if (candidateSellerId) connection.historySellerId = candidateSellerId;
        if (sameWbSeller) {
          connection.financeEncrypted = old?.financeEncrypted;
          connection.financeVersion = old?.financeVersion;
        }
        await put(tx, "marketplace_connections", b.provider, connection);
        if (sameWbSeller) return;
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
        const existing = await loadMarketplaces(tx);
        await put(tx, "marketplace_settings", "common", {
          ...existing.settings,
          ...Object.fromEntries(
            Object.entries(settings).filter(([, value]) => value !== undefined),
          ),
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
      if (c.historyLease && Date.parse(c.historyLease.until) > Date.now())
        throw new ConflictException(
          "Завершается страница истории. Повторите через минуту.",
        );
      if (
        c.syncStatus === "running" &&
        c.lastAttemptAt &&
        Date.now() - Date.parse(c.lastAttemptAt) < MARKETPLACE_RUN_LEASE_MS
      )
        throw new ConflictException("Загрузка уже выполняется");
      const credentials = await this.secrets.decrypt<MarketplaceCredentials>(
          c.encrypted,
          c.provider,
        ),
        runId = randomUUID();
      c.syncStatus = "running";
      c.syncMode = "manual";
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
    const result = await this._fetchSync(
      b.provider,
      start.credentials!,
      start.historyDays!,
    );
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx, true);
      const c = this._connection(await loadMarketplaces(tx), b.provider);
      if (c.version !== start.version || c.runId !== start.runId || !c.enabled)
        throw new ConflictException(
          "Настройки подключения изменились. Повторите загрузку.",
        );
      await this._publishSync(tx, c, result);
      const response = await this._overview(tx);
      await tx.query(
        "UPDATE commands SET response=$1 WHERE request_id=$2 AND fingerprint=$3",
        [JSON.stringify(response), b.requestId, start.fp],
      );
      return response;
    });
  }
  // The background entry point has no HTTP route and cannot inherit a browser session.
  // Its authority is limited to previously approved, enabled encrypted connections.
  async syncMarketplaceAutomatically(
    provider: MarketplaceProvider,
    slotStartedAt: number,
    signal?: AbortSignal,
  ): Promise<"updated" | "failed" | "skipped" | "superseded"> {
    if (requestAuth.getStore()?.http)
      throw new ForbiddenException("Автообновление недоступно из HTTP-запроса");
    const interval = 30 * 60000;
    if (
      !D.MARKETPLACE_PROVIDERS.includes(provider) ||
      !Number.isSafeInteger(slotStartedAt) ||
      slotStartedAt < 0 ||
      slotStartedAt % interval !== 0 ||
      slotStartedAt > Date.now() ||
      signal?.aborted
    )
      return "skipped";
    const start = await this.warehouse.authTransaction(async (tx) => {
      if (signal?.aborted) return undefined;
      const m = await loadMarketplaces(tx),
        c = m.connections.find((entry) => entry.provider === provider);
      if (!c?.enabled || !c.encrypted) return undefined;
      if (c.historyLease && Date.parse(c.historyLease.until) > Date.now())
        return undefined;
      const attemptedAt = c.lastAttemptAt ? Date.parse(c.lastAttemptAt) : NaN;
      if (
        attemptedAt >= slotStartedAt ||
        (c.syncStatus === "running" &&
          Number.isFinite(attemptedAt) &&
          Date.now() - attemptedAt < MARKETPLACE_RUN_LEASE_MS)
      )
        return undefined;
      c.runId = randomUUID();
      c.syncMode = "automatic";
      c.lastAttemptAt = new Date().toISOString();
      c.syncStatus = "running";
      c.message = null;
      await put(tx, "marketplace_connections", provider, c);
      return {
        runId: c.runId,
        version: c.version,
        encrypted: c.encrypted,
        historyDays: m.settings.historyDays,
      };
    });
    if (!start) return "skipped";
    let result: { snapshot?: MarketplaceSnapshot; failureMessage: string };
    try {
      signal?.throwIfAborted();
      const credentials = await this.secrets.decrypt<MarketplaceCredentials>(
        start.encrypted,
        provider,
      );
      result = await this._fetchSync(
        provider,
        credentials,
        start.historyDays,
        signal,
      );
    } catch {
      // Decryption and arbitrary exception messages are never exposed or logged.
      result = {
        failureMessage:
          "Не удалось обновить данные. Проверьте подключение маркетплейса.",
      };
    }
    const finish = (discard = false) =>
      this.warehouse.authTransaction(async (tx) => {
        const c = (await loadMarketplaces(tx)).connections.find(
          (entry) => entry.provider === provider,
        );
        if (
          !c?.enabled ||
          c.version !== start.version ||
          c.runId !== start.runId
        )
          return "superseded" as const;
        // Shutdown wins even when a provider completes while the transaction is queued.
        if (signal?.aborted || discard)
          result = {
            failureMessage: "Обновление прервано. Предыдущие данные сохранены.",
          };
        return (await this._publishSync(
          tx,
          c,
          result,
          discard ? undefined : signal,
        ))
          ? ("updated" as const)
          : ("failed" as const);
      });
    try {
      return await finish();
    } catch (error) {
      // Roll back a snapshot write if shutdown arrived during publication, then
      // release only this run's claim in a separate transaction.
      if (signal?.aborted && error === signal.reason) return finish(true);
      throw error;
    }
  }

  private async _abortable<T>(
    pending: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          onAbort = () =>
            reject(
              new MarketplaceProviderError("aborted", "Загрузка прервана"),
            );
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        }),
      ]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
  private async _fetchSync(
    provider: MarketplaceProvider,
    credentials: MarketplaceCredentials,
    historyDays: number,
    signal?: AbortSignal,
  ): Promise<{ snapshot?: MarketplaceSnapshot; failureMessage: string }> {
    const combinedSignal = signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(MARKETPLACE_RUN_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(MARKETPLACE_RUN_TIMEOUT_MS);
    const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10),
      to = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10),
      from = new Date(Date.parse(to) - (historyDays - 1) * 86400000)
        .toISOString()
        .slice(0, 10);
    let snapshot: MarketplaceSnapshot | undefined;
    let failureMessage =
      "Загрузка не удалась. Повторите позже. Предыдущая полная загрузка сохранена.";
    try {
      combinedSignal.throwIfAborted();
      snapshot = await this._abortable(
        this.fetchSnapshot(
          provider,
          credentials,
          { from, to },
          { signal: combinedSignal },
        ),
        combinedSignal,
      );
      combinedSignal.throwIfAborted();
    } catch (error) {
      snapshot = undefined;
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
            provider,
            code: error.code,
            operation,
            status,
            attempt,
            retryAfterSeconds,
          });
        }
      }
    }
    return { snapshot, failureMessage };
  }
  private async _publishSync(
    tx: Queryable,
    c: Connection,
    result: { snapshot?: MarketplaceSnapshot; failureMessage: string },
    signal?: AbortSignal,
  ) {
    const complete =
      !!result.snapshot &&
      result.snapshot.provider === c.provider &&
      result.snapshot.coverage.catalog &&
      result.snapshot.coverage.stocks &&
      result.snapshot.coverage.demand;
    c.runId = null;
    c.syncStatus = complete
      ? "success"
      : result.snapshot
        ? "partial"
        : "failed";
    c.message = complete
      ? "Данные загружены"
      : result.snapshot
        ? "Получены неполные данные. Сохранена последняя полная загрузка."
        : result.failureMessage;
    c.warnings = complete ? result.snapshot!.warnings : [];
    if (complete) {
      c.lastSuccessAt = new Date().toISOString();
      c.lastSuccessVersion = c.version;
      signal?.throwIfAborted();
      await supersedePositiveStockResolutions(tx, c, result.snapshot!);
      await put(tx, "marketplace_snapshots", c.provider, result.snapshot);
      await archiveMarketplaceSnapshot(tx, c, result.snapshot!);
      signal?.throwIfAborted();
      await tx.query("DELETE FROM marketplace_transit");
      signal?.throwIfAborted();
    }
    await put(tx, "marketplace_connections", c.provider, c);
    signal?.throwIfAborted();
    return complete;
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
        forecast = await readForecastPlanContext(tx, marketplace),
        plan = marketplacePlan(state, marketplace, new Date(), forecast),
        row = plan.rows.find((r) => r.skuId === b.skuId);
      if (!row || row.proposalHash !== b.proposalHash)
        throw new ConflictException("Расчёт устарел. Обновите рекомендации.");
      const backlog = b.purpose === "backlog";
      if (backlog ? !row.backlogCanCreate : !row.canCreate)
        throw new BadRequestException(
          backlog ? row.backlogReason : row.blockers.join(". "),
        );
      const boxesTarget = 1;
      const taskId = await this.warehouse.commitPlanningTask(
        tx,
        structuredClone(state),
        state,
        {
          requestId: b.requestId,
          skuId: b.skuId,
          boxesTarget,
        },
      );
      await put(tx, "marketplace_task_origins", taskId, {
        taskId,
        skuId: b.skuId,
        sourceType: "forecast",
        proposalHash: b.proposalHash,
        createdAt: new Date().toISOString(),
        actorAccountId: actor.id,
        recommendedBoxes: boxesTarget,
        purpose: b.purpose ?? "urgent",
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
