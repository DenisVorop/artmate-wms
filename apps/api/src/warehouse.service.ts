import { initializeForecastStorage } from "./forecasting/forecast-storage";
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createDatabase, Database, Queryable } from "./database";
import { requestAuth, projectWorkspace } from "./auth-context";
import {
  initializeWorkforce,
  workforceBefore,
  recordWorkforce,
  reportPeriod,
  performanceReport,
  shiftHistory,
  workHistory,
} from "./workforce";
import { authorizeWarehouse } from "./auth-policy";
import {
  initializeStocktakes,
  cellFingerprints,
  advanceCellVersions,
} from "./stocktake-versions";
import {
  initializeBoxLabels,
  confirmBoxLabel,
  closeBoxLabels,
} from "./box-label-storage";
import { initializeAuth } from "./auth-storage";
import {
  initializeMarketplaceStorage,
  loadMarketplaces,
} from "./marketplaces/storage";
import {
  initializeForecastHistoryStorage,
  bootstrapForecastHistory,
} from "./forecasting/history-storage";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import * as D from "./dto";
import {
  reconcileStockPositions,
  initializeStockLedger,
  stockPositions,
  stockDifference,
  ledgerEvent,
  appendStockEvent,
} from "./stock-ledger";
import {
  activeZoneLocation,
  canonicalAssemblyLocation,
  validateWorkZone,
  zoneIdentity,
} from "./work-zones";
import { generateSectionIdentity } from "./section-identity";
import { seedWorkspace } from "./seed";
import { workRoute, validateWorkRouteQuery } from "./work-route";
import {
  rankPlacementLocations,
  receiptSourceLocation,
} from "./placement-ranking";
import {
  checkRect,
  checkBounds,
  checkEntrance,
  geometryChanged,
  checkSpace,
  checkPlanState,
  legacyDoorBinding,
  translateSpaceContents,
  checkSpaceResizeContents,
} from "./layout";
import {
  migrateSpaces,
  migratePlanBuilder,
  migrateAddressesAndMovements,
} from "./migrations";
import {
  DEMO_PACKAGING,
  packagingError,
  finishedMetrics,
  placementError,
  samePackaging,
  assemblyMetrics,
  putawayPlacementError,
} from "./physical";
const tables = [
  "putawayTasks",
  "receipts",
  "aisles",
  "entrances",
  "sections",
  "movements",
  "skus",
  "locations",
  "lots",
  "pallets",
  "boxes",
  "tasks",
  "employees",
  "shipments",
  "activities",
] as const;
type Table = (typeof tables)[number];
function fail(message: string): never {
  throw new BadRequestException(message);
}
const find = <T extends { id: string }>(
  list: T[],
  id: string,
  label: string,
): T =>
  list.find((x) => x.id === id) ??
  (() => {
    throw new NotFoundException(`${label} не найден`);
  })();
const now = () => new Date().toISOString();
const nextCode = (prefix: string) =>
  `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
function activity(
  state: D.WorkspaceDto,
  title: string,
  description: string,
  kind: string,
) {
  state.activities.unshift({
    id: randomUUID(),
    title,
    description,
    kind,
    createdAt: now(),
    ...(requestAuth.getStore()?.http
      ? {
          actorEmployeeId: requestAuth.getStore()!.employeeId ?? null,
          actorName:
            state.employees.find(
              (e) => e.id === requestAuth.getStore()!.employeeId,
            )?.name ?? null,
        }
      : {}),
  });
}

@Injectable()
export class WarehouseService implements OnModuleDestroy, OnModuleInit {
  private db!: Database;
  private ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor() {
    this.ready = this._initialize();
  }
  async authTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    await this.ready;
    return this._enqueue(() => this.db.transaction(fn));
  }
  async onModuleInit() {
    await this.ready;
  }
  private async _initialize() {
    this.db = await createDatabase();
    for (const table of tables)
      await this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, payload JSONB NOT NULL)`,
      );
    await this.db.exec(
      "CREATE TABLE IF NOT EXISTS commands (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await this.db.transaction(async (tx) => {
      const initialized = await tx.query(
        "SELECT key FROM metadata WHERE key=$1",
        ["seeded"],
      );
      if (!initialized.rows.length) {
        const seed = seedWorkspace();
        for (const table of tables)
          for (const entity of seed[table] ?? [])
            await tx.query(`INSERT INTO ${table}(id,payload) VALUES ($1,$2)`, [
              entity.id,
              JSON.stringify(entity),
            ]);
        await tx.query("INSERT INTO metadata(key,value) VALUES ($1,$2)", [
          "seeded",
          "1",
        ]);
      }
      const version = await tx.query<{ value: string }>(
        "SELECT value FROM metadata WHERE key=$1",
        ["schema_version"],
      );
      if (Number(version.rows[0]?.value ?? 1) < 2) {
        const state = migrateAddressesAndMovements(await this._load(tx));
        await this._persist(tx, state);
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "2"],
        );
      }
      if (Number(version.rows[0]?.value ?? 1) < 3) {
        const state = migratePlanBuilder(await this._load(tx));
        await this._persist(tx, state);
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "3"],
        );
      }
      if (Number(version.rows[0]?.value ?? 1) < 4) {
        const state = migrateSpaces(await this._load(tx));
        await this._persist(tx, state);
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "4"],
        );
      }
      if (Number(version.rows[0]?.value ?? 1) < 5) {
        // Receipt history starts here. Existing stock is preserved without invented documents.
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "5"],
        );
      }
      if (Number(version.rows[0]?.value ?? 1) < 6) {
        const state = await this._load(tx);
        for (const task of state.tasks) {
          task.createdAt ??= null;
          task.boxCodeConfirmed ??= task.scannedUnits > 0;
        }
        await this._persist(tx, state);
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "6"],
        );
      }
      if (Number(version.rows[0]?.value ?? 1) < 7) {
        const state = await this._load(tx);
        this._enqueueMissingPutaways(state);
        await this._persist(tx, state);
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "7"],
        );
      }
      await tx.query(
        "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO NOTHING",
        ["workspace_revision", "0"],
      );
      await initializeStockLedger(tx);
      if (Number(version.rows[0]?.value ?? 1) < 8) {
        const state = await this._load(tx);
        await appendStockEvent(tx, ledgerEvent(state, stockPositions(state)));
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "8"],
        );
      }
      await initializeAuth(tx);
      if (Number(version.rows[0]?.value ?? 1) < 9)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "9"],
        );
      await initializeWorkforce(tx, await this._load(tx));
      if (Number(version.rows[0]?.value ?? 1) < 10)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "10"],
        );
      await initializeStocktakes(tx, await this._load(tx));
      if (Number(version.rows[0]?.value ?? 1) < 11)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "11"],
        );
      if (Number(version.rows[0]?.value ?? 1) < 12)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "12"],
        );
      await initializeBoxLabels(tx);
      if (Number(version.rows[0]?.value ?? 1) < 13)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "13"],
        );
      await initializeMarketplaceStorage(tx);
      if (Number(version.rows[0]?.value ?? 1) < 14)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "14"],
        );
      await initializeForecastHistoryStorage(tx);
      await initializeForecastStorage(tx);
      if (Number(version.rows[0]?.value ?? 1) < 15) {
        const marketplaces = await loadMarketplaces(tx);
        await bootstrapForecastHistory(
          tx,
          marketplaces.connections,
          marketplaces.snapshots,
        );
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "15"],
        );
      }
      if (Number(version.rows[0]?.value ?? 1) < 16)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "16"],
        );
      if (Number(version.rows[0]?.value ?? 1) < 17)
        await tx.query(
          "INSERT INTO metadata(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
          ["schema_version", "17"],
        );
    });
  }
  stocktakeState(tx: Queryable) {
    return this._load(tx);
  }
  async commitStocktake(
    tx: Queryable,
    before: D.WorkspaceDto,
    state: D.WorkspaceDto,
    body: D.ReasonStocktakeDto,
    document: { id: string; code: string },
  ) {
    activity(
      state,
      "Инвентаризация утверждена",
      `${document.code}: ${body.reason.trim()}`,
      "adjustment",
    );
    await this._commitState(
      tx,
      before,
      state,
      "approveStocktake",
      body,
      document,
    );
  }
  private _enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(fn, fn);
    this.tail = job.catch(() => {});
    return job;
  }
  private async _load(query: Queryable): Promise<D.WorkspaceDto> {
    const state = {} as D.WorkspaceDto;
    for (const table of tables) {
      const result = await query.query(
        `SELECT payload FROM ${table} ORDER BY id`,
      );
      (state[table] as unknown[]) = result.rows.map((row) => row.payload);
    }
    const plan = await query.query<{ value: string }>(
      "SELECT value FROM metadata WHERE key=$1",
      ["warehouse"],
    );
    state.warehouse = plan.rows[0] ? JSON.parse(plan.rows[0].value) : undefined;
    const revision = await query.query<{ value: string }>(
      "SELECT value FROM metadata WHERE key=$1",
      ["workspace_revision"],
    );
    state.revision = Number(revision.rows[0]?.value ?? 0);
    if (!Number.isSafeInteger(state.revision) || state.revision < 0)
      throw new Error("Некорректная ревизия склада в metadata");
    state.activities.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    this._deriveBalance(state);
    if (state.warehouse) {
      state.warehouse.workZones ??= [];
      state.warehouse.zoneWork ??= [];
    }
    return state;
  }
  async snapshot() {
    await this.ready;
    return this._enqueue(() =>
      this.db.transaction(async (tx) => {
        const state = await this._load(tx);
        if (requestAuth.getStore()?.http)
          await authorizeWarehouse(tx, "getWorkspace", undefined, state);
        return projectWorkspace(state);
      }),
    );
  }
  private async _readState(operation: string): Promise<D.WorkspaceDto> {
    return this.authTransaction(async (tx) => {
      const state = await this._load(tx);
      if (requestAuth.getStore()?.http)
        await authorizeWarehouse(tx, operation, undefined, state);
      return state;
    });
  }
  private async _workforceRead<T>(
    operation: string,
    q: D.PerformanceQueryDto,
    read: (
      tx: Queryable,
      state: D.WorkspaceDto,
      employees: D.EmployeeDto[],
      period: Awaited<ReturnType<typeof reportPeriod>>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.authTransaction(async (tx) => {
      const state = await this._load(tx),
        context = requestAuth.getStore();
      if (context?.http)
        await authorizeWarehouse(tx, operation, undefined, state);
      if (
        context?.http &&
        context.role !== "manager" &&
        q.employeeId !== undefined &&
        q.employeeId !== context.employeeId
      )
        throw new ForbiddenException("Можно просматривать только свою историю");
      const employeeId =
        context?.http && context.role !== "manager"
          ? context.employeeId
          : q.employeeId;
      if (
        employeeId !== undefined &&
        !state.employees.some((e) => e.id === employeeId)
      )
        throw new NotFoundException("Сотрудник не найден");
      const employees = state.employees
        .filter((e) => employeeId === undefined || e.id === employeeId)
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
      return read(tx, state, employees, await reportPeriod(tx, q));
    });
  }
  getPerformance(q: D.PerformanceQueryDto = {}) {
    return this._workforceRead("getPerformance", q, performanceReport);
  }
  getShiftHistory(q: D.WorkforceHistoryQueryDto = {}) {
    return this._workforceRead(
      "getShiftHistory",
      q,
      (tx, _state, employees, period) =>
        shiftHistory(
          tx,
          employees.map((e) => e.id),
          q,
          period,
        ),
    );
  }
  getWorkHistory(q: D.WorkforceHistoryQueryDto = {}) {
    return this._workforceRead(
      "getWorkHistory",
      q,
      (tx, _state, employees, period) =>
        workHistory(
          tx,
          employees.map((e) => e.id),
          q,
          period,
        ),
    );
  }
  async getStockLedger(
    query: D.StockLedgerQueryDto = {},
  ): Promise<D.StockLedgerPageDto> {
    await this.ready;
    for (const value of [query.from, query.to])
      if (value !== undefined && !Number.isFinite(Date.parse(value)))
        fail("Укажите корректные даты периода в ISO 8601");
    if (
      query.from &&
      query.to &&
      new Date(query.from).getTime() > new Date(query.to).getTime()
    )
      fail("Начало периода позже окончания");
    return this._enqueue(() =>
      this.db.transaction(async (tx) => {
        const state = await this._load(tx);
        if (requestAuth.getStore()?.http)
          await authorizeWarehouse(tx, "getStockLedger", undefined, state);
        const params: unknown[] = [];
        const where: string[] = [];
        const parameter = (value: unknown) => {
          params.push(value);
          return `$${params.length}`;
        };
        if (query.kind) where.push(`kind=${parameter(query.kind)}`);
        if (query.employeeId)
          where.push(`payload->>'employeeId'=${parameter(query.employeeId)}`);
        if (query.skuId)
          where.push(
            `EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'lines') l WHERE l->>'skuId'=${parameter(query.skuId)})`,
          );
        if (query.from)
          where.push(
            `created_at>=${parameter(new Date(query.from).toISOString())}::timestamptz`,
          );
        if (query.to)
          where.push(
            `created_at<=${parameter(new Date(query.to).toISOString())}::timestamptz`,
          );
        if (query.search) {
          const p = parameter(`%${query.search.replace(/[\\%_]/g, "\\$&")}%`);
          where.push(
            `(payload->>'referenceCode' ILIKE ${p} OR payload->>'employeeName' ILIKE ${p} OR payload->>'reason' ILIKE ${p} OR EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'lines') l WHERE l->>'skuCode' ILIKE ${p} OR l->>'skuName' ILIKE ${p} OR l->>'lotName' ILIKE ${p} OR l->>'containerCode' ILIKE ${p} OR l->>'palletCode' ILIKE ${p} OR l->>'locationCode' ILIKE ${p}))`,
          );
        }
        const filter = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const count = await tx.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM stock_ledger ${filter}`,
          params,
        );
        const page = query.page ?? 1,
          pageSize = query.pageSize ?? 25;
        const rows = await tx.query<{ payload: D.StockLedgerEventDto }>(
          `SELECT payload FROM stock_ledger ${filter} ORDER BY created_at DESC,revision DESC,id DESC LIMIT ${parameter(pageSize)} OFFSET ${parameter((BigInt(page - 1) * BigInt(pageSize)).toString())}`,
          params,
        );
        const summary = await tx.query<{
          started_at: string;
          events_count: string;
          ledger_units: string;
        }>(
          "SELECT MIN(created_at)::text AS started_at,COUNT(*) AS events_count,COALESCE(SUM((payload->>'unitsDelta')::bigint),0) AS ledger_units FROM stock_ledger",
        );
        const result = summary.rows[0];
        const ledgerUnits = Number(result.ledger_units),
          onHandUnits = state.balance.totalUnits;
        return {
          items: rows.rows.map((r) => r.payload),
          total: Number(count.rows[0].count),
          page,
          pageSize,
          summary: {
            startedAt: new Date(result.started_at).toISOString(),
            eventsCount: Number(result.events_count),
            ledgerUnits,
            onHandUnits,
            reconciled:
              ledgerUnits === onHandUnits &&
              (await reconcileStockPositions(tx, stockPositions(state))),
          },
        };
      }),
    );
  }
  adjustStock(b: D.AdjustStockDto) {
    return this._command("adjustStock", b, (s) => {
      if (find(s.employees, b.employeeId, "Сотрудник").status !== "working")
        fail("Для корректировки сотрудник должен быть на смене");
      if (
        !b.reason?.trim() ||
        b.reason.trim().length < 5 ||
        b.reason.trim().length > 500
      )
        fail("Укажите причину от 5 до 500 символов");
      if (
        ![b.expectedQuantity, b.countedQuantity].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000000,
        )
      )
        fail("Количество должно быть целым неотрицательным числом");
      if (b.kind !== "raw_count" && b.kind !== "box_writeoff")
        fail("Неизвестный вид корректировки");
      const box =
        b.kind === "box_writeoff" ? find(s.boxes, b.targetId, "Короб") : null;
      const pallet = find(s.pallets, box?.palletId ?? b.targetId, "Паллета");
      if (
        pallet.locationId !== b.expectedLocationId ||
        (box ? (box.status === "stored" ? 1 : 0) : pallet.quantity) !==
          b.expectedQuantity
      )
        throw new ConflictException(
          "Остаток или адрес изменились. Обновите данные и повторите пересчёт",
        );
      if (pallet.status !== "stored" || !pallet.locationId)
        fail("Корректировка доступна только для размещённой паллеты");
      const location = this._activeLocation(s, pallet.locationId);
      if (location.blocked) fail("Адрес заблокирован");
      if (
        s.movements.some(
          (m) =>
            m.palletId === pallet.id &&
            ["planned", "in_transit"].includes(m.status),
        )
      )
        fail("Паллета участвует в перемещении");
      if (this._incomingPutaway(s, location.id).length)
        fail("Адрес зарезервирован для размещения короба");
      if (b.kind === "raw_count") {
        if (pallet.kind !== "raw" || !pallet.lotId || !pallet.skuId)
          fail("Для пересчёта нужна сырьевая паллета с известной партией");
        if (find(s.lots, pallet.lotId, "Партия").skuId !== pallet.skuId)
          fail("Партия не соответствует тематике паллеты");
        if (this._reserved(s, pallet.id) > 0)
          fail("Остаток зарезервирован заданием сборки");
        if (b.countedQuantity === pallet.quantity)
          fail("Пересчитанное количество совпадает с текущим");
        pallet.quantity = b.countedQuantity;
      } else {
        if (
          !box ||
          box.status !== "stored" ||
          box.palletId !== pallet.id ||
          box.locationId !== pallet.locationId ||
          pallet.kind !== "finished" ||
          location.kind === "assembly"
        )
          fail(
            "Списать можно размещённый короб с паллеты хранения готовой продукции",
          );
        if (b.expectedQuantity !== 1 || b.countedQuantity !== 0)
          fail("Для списания короба ожидается количество 1 и результат 0");
        if (
          s.shipments.some(
            (x) => x.status === "draft" && x.boxIds.includes(box.id),
          )
        )
          fail("Короб зарезервирован отгрузкой");
        if (
          s.putawayTasks.some(
            (x) =>
              x.status !== "completed" &&
              (x.boxId === box.id || x.fromPalletId === pallet.id),
          )
        )
          fail("Короб или паллета участвуют в размещении");
        box.status = "written_off";
        pallet.quantity--;
        this._recomputePallet(s, pallet);
      }
      activity(
        s,
        "Корректировка остатка",
        `${pallet.code}: ${b.reason.trim()}`,
        "adjustment",
      );
    });
  }
  private async _command(
    operation: string,
    body: D.CommandDto,
    mutate: (state: D.WorkspaceDto, tx: Queryable) => void | Promise<void>,
  ): Promise<D.WorkspaceDto> {
    await this.ready;
    if (!body.requestId?.trim())
      fail("Для операции нужен уникальный requestId");
    const context = requestAuth.getStore();
    return this._enqueue(() =>
      this.db.transaction(async (tx) => {
        const state = await this._load(tx);
        if (context?.http) await authorizeWarehouse(tx, operation, body, state);

        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify(
              context?.http
                ? [
                    operation,
                    body,
                    {
                      accountId: context.accountId,
                      employeeId: context.employeeId,
                    },
                  ]
                : [operation, body],
            ),
          )
          .digest("hex");
        if (
          (
            await tx.query(
              "SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1",
              [body.requestId],
            )
          ).rows.length
        )
          throw new ConflictException(
            "Этот requestId уже использован для другой операции",
          );
        const previous = await tx.query<{
          fingerprint: string;
          response: D.WorkspaceDto;
        }>("SELECT fingerprint,response FROM commands WHERE request_id=$1", [
          body.requestId,
        ]);
        if (previous.rows[0]) {
          if (previous.rows[0].fingerprint !== fingerprint)
            throw new ConflictException(
              "Этот requestId уже использован для другой операции",
            );
          return projectWorkspace(previous.rows[0].response, context);
        }
        const before = structuredClone(state);
        await mutate(state, tx);
        await closeBoxLabels(tx, before, state);
        await this._commitState(tx, before, state, operation, body);
        await tx.query(
          "INSERT INTO commands(request_id,fingerprint,response) VALUES ($1,$2,$3)",
          [body.requestId, fingerprint, JSON.stringify(state)],
        );
        return projectWorkspace(state, context);
      }),
    );
  }
  private async _commitState(
    tx: Queryable,
    before: D.WorkspaceDto,
    state: D.WorkspaceDto,
    operation: string,
    body: D.CommandDto,
    stocktake?: { id: string; code: string },
  ) {
    this._assertZoneIntegrity(state);
    this._assertIntegrity(state);
    this._deriveBalance(state);
    if (state.revision >= Number.MAX_SAFE_INTEGER)
      fail("Достигнут предел ревизии склада");
    state.revision++;
    await this._persist(tx, state);
    const lines = stockDifference(
      stockPositions(before),
      stockPositions(state),
    );
    if (
      /^(?:(scanTask|packTask|takePutawayTask|placePutawayTask|takePutawayBox|placePutawayBox|takeMovement|placeMovement)\/|takeAnyPutawayBox$)/.test(
        operation,
      )
    ) {
      const lots = new Map<string, number>();
      for (const line of lines) {
        const key = JSON.stringify([line.skuId, line.lotId]);
        lots.set(key, (lots.get(key) ?? 0) + line.quantityDelta);
      }
      if ([...lots.values()].some((delta) => delta !== 0))
        throw new Error("Внутренняя операция нарушает сохранность партии");
    }
    if (lines.length) {
      const event = ledgerEvent(
        state,
        lines,
        operation,
        body,
        requestAuth.getStore()?.http
          ? requestAuth.getStore()?.employeeId
          : undefined,
      );
      if (stocktake) {
        event.kind = "adjustment";
        event.referenceType = "stocktake";
        event.referenceId = stocktake.id;
        event.referenceCode = stocktake.code;
        event.reason = (body as D.ReasonStocktakeDto).reason.trim();
      }
      await appendStockEvent(tx, event);
    }
    await advanceCellVersions(tx, cellFingerprints(before), state);
    await recordWorkforce(tx, workforceBefore(before), state, body);
  }
  private async _persist(tx: Queryable, state: D.WorkspaceDto) {
    for (const table of tables) {
      const ids = state[table].map((item) => item.id);
      if (ids.length)
        await tx.query(`DELETE FROM ${table} WHERE NOT(id=ANY($1::text[]))`, [
          ids,
        ]);
      else await tx.query(`DELETE FROM ${table}`);
      for (const entity of state[table])
        await tx.query(
          `INSERT INTO ${table}(id,payload) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,
          [entity.id, JSON.stringify(entity)],
        );
    }
    if (state.warehouse)
      await tx.query(
        "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        ["warehouse", JSON.stringify(state.warehouse)],
      );
    await tx.query(
      "INSERT INTO metadata(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      ["workspace_revision", String(state.revision)],
    );
  }
  private _assertIntegrity(s: D.WorkspaceDto) {
    const receiptPallets = new Set<string>();
    for (const receipt of s.receipts) {
      if (!receipt.pallets.length) fail("Пустой документ приёмки");
      for (const row of receipt.pallets) {
        if (receiptPallets.has(row.palletId))
          fail("Паллета принадлежит более чем одной строке приёмки");
        receiptPallets.add(row.palletId);
        const p = find(s.pallets, row.palletId, "Паллета приёмки");
        if (
          p.kind !== "raw" ||
          p.skuId !== row.skuId ||
          !Number.isInteger(row.quantity) ||
          row.quantity <= 0
        )
          fail("Некорректный состав документа приёмки");
        if (row.placedAt === null) {
          if (
            p.status !== "awaiting_placement" ||
            p.quantity !== row.quantity ||
            row.locationId !== null ||
            row.placedByEmployeeId !== null
          )
            fail("Несогласованная ожидающая строка приёмки");
        } else {
          if (
            p.status === "awaiting_placement" ||
            !row.locationId ||
            !row.placedByEmployeeId
          )
            fail("Несогласованная размещённая строка приёмки");
          find(s.locations, row.locationId, "Исторический адрес приёмки");
          find(s.employees, row.placedByEmployeeId, "Исполнитель приёмки");
        }
      }
      const count = receipt.pallets.filter(
        (row) => row.placedAt !== null,
      ).length;
      const status =
        count === receipt.pallets.length
          ? "completed"
          : count
            ? "partially_placed"
            : "awaiting_placement";
      if (
        receipt.status !== status ||
        (status === "completed") !== (receipt.completedAt !== null)
      )
        fail("Несогласованный статус приёмки");
    }
    const occupied = new Set<string>();
    for (const p of s.pallets) {
      if (p.quantity < 0) fail("Остаток паллеты не может быть отрицательным");
      if (
        p.status === "awaiting_placement" &&
        (p.kind !== "raw" ||
          p.quantity <= 0 ||
          p.returnLocationId !== null ||
          !s.receipts.some((r) =>
            r.pallets.some(
              (row) => row.palletId === p.id && row.placedAt === null,
            ),
          ))
      )
        fail("Некорректная ожидающая паллета приёмки");
      if (p.status === "stored") {
        if (!p.locationId) fail("У хранящейся паллеты нужен адрес");
        if (occupied.has(p.locationId))
          fail("На адресе может стоять только одна физическая паллета");
        occupied.add(p.locationId);
        find(s.locations, p.locationId, "Адрес");
      } else if (p.locationId !== null)
        fail("Паллета вне хранения не должна иметь адрес");
      if ((p.kind === "assembly") !== (p.skuId === null))
        fail("Только общая паллета сборки должна иметь пустой SKU");
      if (["finished", "assembly"].includes(p.kind)) {
        const boxes = s.boxes.filter(
          (b) => b.palletId === p.id && b.status === "stored",
        );
        if (
          boxes.length !== p.quantity ||
          boxes.some(
            (b) =>
              (p.kind === "finished" && b.skuId !== p.skuId) ||
              b.locationId !== p.locationId,
          )
        )
          fail("Нарушен состав или адрес паллеты");
      }
    }
    const unfinishedBoxes = new Set<string>();
    for (const t of s.putawayTasks) {
      const box = find(s.boxes, t.boxId, "Короб размещения");
      if (t.skuId !== box.skuId) fail("Нарушен SKU задания размещения");
      if (t.status !== "completed") {
        if (unfinishedBoxes.has(t.boxId))
          fail("У короба несколько незавершённых размещений");
        unfinishedBoxes.add(t.boxId);
        if (t.status === "in_transit") {
          if (
            box.status !== "in_transit" ||
            box.palletId !== null ||
            box.locationId !== null ||
            !t.employeeId ||
            !t.toLocationId
          )
            fail("Нарушено состояние короба в размещении");
        } else if (
          box.status !== "stored" ||
          box.palletId !== t.fromPalletId ||
          box.locationId !== t.fromLocationId
        )
          fail("Короб не находится на источнике размещения");
      }
    }
    for (const box of s.boxes) {
      if (
        box.status === "in_transit" &&
        !s.putawayTasks.some(
          (t) => t.boxId === box.id && t.status === "in_transit",
        )
      )
        fail("Короб в пути без задания размещения");
      if (box.lotContents.reduce((sum, c) => sum + c.quantity, 0) !== box.units)
        fail("Нарушен состав короба");
      if (
        box.lotContents.some(
          (c) => find(s.lots, c.lotId, "Партия").skuId !== box.skuId,
        )
      )
        fail("Разные тематики в коробе запрещены");
    }
  }
  private _activeSection(s: D.WorkspaceDto, id: string) {
    const section = find(s.sections, id, "Секция");
    if (section.archived) fail("Секция находится в архиве");
    return section;
  }
  private _isActiveLocation(s: D.WorkspaceDto, id: string) {
    const l = s.locations.find((l) => l.id === id);
    return (
      !!l &&
      !l.archived &&
      (!l.sectionId ||
        s.sections.some(
          (section) => section.id === l.sectionId && !section.archived,
        ))
    );
  }
  private _activeLocation(s: D.WorkspaceDto, id: string) {
    const location = find(s.locations, id, "Адрес");
    if (
      location.archived ||
      (location.sectionId &&
        find(s.sections, location.sectionId, "Секция").archived)
    )
      fail("Адрес находится в архиве");
    return location;
  }
  private _archiveAddressGuard(s: D.WorkspaceDto, id: string) {
    if (this._incomingPutaway(s, id).length)
      fail("Адрес зарезервирован размещением коробов");
    if (s.pallets.some((p) => p.status === "stored" && p.locationId === id))
      fail(
        "На адресе физически стоит паллета, включая пустую. Сначала переместите или вывезите её",
      );
    if (s.boxes.some((box) => box.status === "stored" && box.locationId === id))
      fail("На адресе находятся готовые короба");
    if (
      s.pallets.some((p) => p.status !== "retired" && p.returnLocationId === id)
    )
      fail("Адрес удерживается для возврата паллеты");
    if (
      s.movements.some(
        (m) =>
          ["planned", "in_transit"].includes(m.status) &&
          (m.fromLocationId === id || m.toLocationId === id),
      )
    )
      fail("Адрес является источником или назначением активного перемещения");
  }
  updateWarehousePlan(b: D.UpdateWarehousePlanDto) {
    return this._command("updateWarehousePlan", b, (s) => {
      const { requestId, ...changes } = this._definedChanges(b);
      if (b.name !== undefined) {
        if (!b.name.trim()) fail("Укажите название склада");
        changes.name = b.name.trim();
      }
      const plan = { ...s.warehouse, ...changes };
      if (
        !Number.isFinite(plan.width) ||
        !Number.isFinite(plan.depth) ||
        plan.width < 1 ||
        plan.depth < 1 ||
        plan.width > 1000 ||
        plan.depth > 1000
      )
        fail("Размеры помещения должны быть от 1 до 1000 метров");
      const next = { ...s, warehouse: plan };
      checkPlanState(next);
      s.warehouse = plan;
      activity(
        s,
        "План склада обновлён",
        `${plan.name} · ${plan.width} × ${plan.depth} м`,
        "layout",
      );
    });
  }
  createSpace(b: D.CreateSpaceDto) {
    return this._command("createSpace", b, (s) => {
      if (!b.name.trim()) fail("Укажите название участка");
      const { requestId, ...fields } = b;
      const space = {
        ...fields,
        id: randomUUID(),
        name: b.name.trim(),
        archived: false,
        archivedAt: null,
      };
      const previousPlan = s.warehouse;
      s.warehouse = {
        ...s.warehouse,
        layoutMode: "spaces",
        spaces: [...s.warehouse.spaces, space],
      };
      checkSpace(s.warehouse, space);
      if (previousPlan.layoutMode === "rectangle") {
        for (const entrance of s.entrances.filter((e) => e.spaceId === null)) {
          const binding = legacyDoorBinding(previousPlan, entrance, space);
          if (binding) Object.assign(entrance, binding);
          else if (!entrance.archived)
            fail(
              "Первый участок должен сохранить существующие входы: его стена должна точно совпадать с прежним проёмом. Либо сначала уберите этот вход в корзину.",
            );
        }
      }
      checkPlanState(s);
      activity(
        s,
        "Добавлен участок",
        `${space.name} · ${space.kind === "room" ? "помещение" : "коридор"} · ${space.width * space.depth} м²`,
        "layout",
      );
    });
  }
  updateSpace(id: string, b: D.UpdateSpaceDto) {
    return this._command(`updateSpace/${id}`, b, (s) => {
      const space = find(s.warehouse.spaces, id, "Участок");
      if (space.archived) fail("Участок находится в архиве");
      const { requestId, ...changes } = this._definedChanges(b);
      if (b.name !== undefined) {
        if (!b.name.trim()) fail("Укажите название участка");
        changes.name = b.name.trim();
      }
      const oldSpace = { ...space };
      Object.assign(space, changes);
      translateSpaceContents(s, oldSpace, space);
      checkPlanState(s);
      activity(s, "Участок обновлён", space.name, "layout");
    });
  }
  resizeSpace(id: string, b: D.ResizeSpaceDto) {
    return this._command(`resizeSpace/${id}`, b, (s) => {
      const space = find(s.warehouse.spaces, id, "Участок");
      if (space.archived) fail("Участок находится в архиве");
      const next = { ...space, x: b.x, y: b.y, width: b.width, depth: b.depth };
      checkSpaceResizeContents(s, space, next);
      Object.assign(space, next);
      checkPlanState(s);
      activity(
        s,
        "Границы участка изменены",
        `${space.name} · содержимое сохраняет координаты`,
        "layout",
      );
    });
  }
  deleteSpace(id: string, b: D.CommandDto) {
    return this._command(`deleteSpace/${id}`, b, (s) => {
      const space = find(s.warehouse.spaces, id, "Участок");
      if (space.archived) return;
      if (s.entrances.some((e) => !e.archived && e.spaceId === id))
        fail(
          "К участку привязаны активные входы. Сначала уберите их в корзину или перенесите на другой участок.",
        );
      space.archived = true;
      space.archivedAt = now();
      checkPlanState(s);
      activity(
        s,
        "Участок убран с плана",
        `${space.name} · сохранён в корзине`,
        "layout",
      );
    });
  }
  restoreSpace(id: string, b: D.CommandDto) {
    return this._command(`restoreSpace/${id}`, b, (s) => {
      const space = find(s.warehouse.spaces, id, "Участок");
      if (!space.archived) return;
      space.archived = false;
      space.archivedAt = null;
      checkPlanState(s);
      activity(s, "Участок восстановлен", space.name, "layout");
    });
  }
  createAisle(b: D.CreateAisleDto) {
    return this._command("createAisle", b, (s) => {
      if (!b.name.trim()) fail("Укажите название прохода");
      const { requestId, ...fields } = b;
      const aisle = {
        ...fields,
        id: randomUUID(),
        name: b.name.trim(),
        rotation: b.rotation ?? 0,
        archived: false,
        archivedAt: null,
      };
      checkRect(s, aisle, "aisle");
      s.aisles.push(aisle);
      activity(s, "Проход добавлен", aisle.name, "layout");
    });
  }
  updateAisle(id: string, b: D.UpdateAisleDto) {
    return this._command(`updateAisle/${id}`, b, (s) => {
      const aisle = find(s.aisles, id, "Проход");
      if (aisle.archived) fail("Проход находится в архиве");
      const { requestId, ...changes } = this._definedChanges(b);
      if (b.name !== undefined) {
        if (!b.name.trim()) fail("Укажите название прохода");
        changes.name = b.name.trim();
      }
      const next = { ...aisle, ...changes };
      if (geometryChanged(aisle, next)) checkRect(s, next, "aisle");
      Object.assign(aisle, next);
      activity(s, "Проход обновлён", aisle.name, "layout");
    });
  }
  createEntrance(b: D.CreateEntranceDto) {
    return this._command("createEntrance", b, (s) => {
      if (!b.name.trim()) fail("Укажите название входа");
      const { requestId, ...fields } = b;
      const entrance = {
        ...fields,
        id: randomUUID(),
        name: b.name.trim(),
        spaceId: b.spaceId ?? null,
        archived: false,
        archivedAt: null,
      };
      checkEntrance(s, entrance);
      s.entrances.push(entrance);
      activity(s, "Вход добавлен", entrance.name, "layout");
    });
  }
  updateEntrance(id: string, b: D.UpdateEntranceDto) {
    return this._command(`updateEntrance/${id}`, b, (s) => {
      const entrance = find(s.entrances, id, "Вход");
      if (entrance.archived) fail("Вход находится в архиве");
      const { requestId, ...changes } = this._definedChanges(b);
      if (b.name !== undefined) {
        if (!b.name.trim()) fail("Укажите название входа");
        changes.name = b.name.trim();
      }
      const next = { ...entrance, ...changes };
      checkEntrance(s, next);
      Object.assign(entrance, next);
      activity(s, "Вход обновлён", entrance.name, "layout");
    });
  }
  deleteLocation(id: string, b: D.CommandDto) {
    return this._command(`deleteLocation/${id}`, b, (s) => {
      const location = find(s.locations, id, "Адрес");
      if (location.archived) return;
      this._archiveAddressGuard(s, id);
      location.archived = true;
      location.archivedAt = now();
      activity(
        s,
        "Адрес убран с плана",
        `${location.code} · сохранён в корзине вместе с QR и историей`,
        "layout",
      );
    });
  }
  restoreLocation(id: string, b: D.CommandDto) {
    return this._command(`restoreLocation/${id}`, b, (s) => {
      const location = find(s.locations, id, "Адрес");
      if (!location.archived) return;
      if (location.sectionId) this._activeSection(s, location.sectionId);
      else checkRect(s, location, "location");
      this._uniqueLocationCode(s, location.code, id);
      location.archived = false;
      location.archivedAt = null;
      activity(s, "Адрес восстановлен", location.code, "layout");
    });
  }
  deleteRackSection(id: string, b: D.CommandDto) {
    return this._command(`deleteRackSection/${id}`, b, (s) => {
      const section = find(s.sections, id, "Секция");
      if (section.archived) return;
      const locations = s.locations.filter(
        (l) => l.sectionId === id && !l.archived,
      );
      for (const location of locations)
        this._archiveAddressGuard(s, location.id);
      const at = now();
      section.archived = true;
      section.archivedAt = at;
      section.archivedLocationIds = locations.map((l) => l.id);
      for (const location of locations) {
        location.archived = true;
        location.archivedAt = at;
      }
      activity(
        s,
        "Секция убрана с плана",
        `${section.code} · ${locations.length} адресов в корзине`,
        "layout",
      );
    });
  }
  restoreRackSection(id: string, b: D.CommandDto) {
    return this._command(`restoreRackSection/${id}`, b, (s) => {
      const section = find(s.sections, id, "Секция");
      if (!section.archived) return;
      checkRect(s, section, "section");
      for (const locationId of section.archivedLocationIds) {
        const location = find(s.locations, locationId, "Адрес");
        this._uniqueLocationCode(s, location.code, location.id);
        location.archived = false;
        location.archivedAt = null;
      }
      section.archived = false;
      section.archivedAt = null;
      section.archivedLocationIds = [];
      activity(s, "Секция восстановлена", section.code, "layout");
    });
  }
  deleteAisle(id: string, b: D.CommandDto) {
    return this._command(`deleteAisle/${id}`, b, (s) => {
      const aisle = find(s.aisles, id, "Проход");
      if (aisle.archived) return;
      aisle.archived = true;
      aisle.archivedAt = now();
      activity(s, "Проход убран с плана", aisle.name, "layout");
    });
  }
  restoreAisle(id: string, b: D.CommandDto) {
    return this._command(`restoreAisle/${id}`, b, (s) => {
      const aisle = find(s.aisles, id, "Проход");
      if (!aisle.archived) return;
      checkRect(s, aisle, "aisle");
      aisle.archived = false;
      aisle.archivedAt = null;
      activity(s, "Проход восстановлен", aisle.name, "layout");
    });
  }
  deleteEntrance(id: string, b: D.CommandDto) {
    return this._command(`deleteEntrance/${id}`, b, (s) => {
      const entrance = find(s.entrances, id, "Вход");
      if (entrance.archived) return;
      entrance.archived = true;
      entrance.archivedAt = now();
      activity(s, "Вход убран с плана", entrance.name, "layout");
    });
  }
  restoreEntrance(id: string, b: D.CommandDto) {
    return this._command(`restoreEntrance/${id}`, b, (s) => {
      const entrance = find(s.entrances, id, "Вход");
      if (!entrance.archived) return;
      checkEntrance(s, entrance);
      entrance.archived = false;
      entrance.archivedAt = null;
      activity(s, "Вход восстановлен", entrance.name, "layout");
    });
  }
  private _definedChanges<T extends object>(dto: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    ) as Partial<T>;
  }
  private _uniqueLocationCode(
    s: D.WorkspaceDto,
    code: string,
    except?: string,
  ) {
    if (!code?.trim()) fail("Укажите код адреса");
    if (
      s.locations.some(
        (l) =>
          l.id !== except && l.code.toLowerCase() === code.trim().toLowerCase(),
      )
    )
      fail("Такой адрес уже существует");
  }
  createLocation(b: D.CreateLocationDto) {
    return this._command("createLocation", b, (s) => {
      this._uniqueLocationCode(s, b.code);
      if (!b.name.trim()) fail("Укажите название");
      if (b.kind === "rack")
        fail("Стеллаж создаётся через секции и адреса ярусов");
      if (b.levels !== 1) fail("Напольный адрес содержит одно паллетоместо");
      const { requestId, ...fields } = b;
      s.locations.push({
        ...fields,
        id: randomUUID(),
        code: b.code.trim(),
        name: b.name.trim(),
        sectionId: null,
        level: 1,
        levels: 1,
        rotation: b.rotation ?? 0,
        archived: false,
        archivedAt: null,
        blocked: b.blocked ?? false,
        maxWeightKg: b.maxWeightKg ?? null,
        accessSides: b.accessSides ?? (b.kind === "picking" ? 4 : 1),
      });
      checkRect(s, s.locations.at(-1)!, "location");
      activity(s, "Создан адрес", b.code, "location");
    });
  }
  updateLocation(id: string, b: D.UpdateLocationDto) {
    return this._command(`updateLocation/${id}`, b, (s) => {
      const l = this._activeLocation(s, id);
      const { requestId, ...changes } = this._definedChanges(b);
      if (b.code !== undefined) this._uniqueLocationCode(s, b.code, id);
      if (b.name !== undefined && !b.name.trim()) fail("Укажите название");
      if (
        l.sectionId &&
        (b.x !== undefined ||
          b.y !== undefined ||
          b.width !== undefined ||
          b.depth !== undefined ||
          b.rotation !== undefined ||
          b.levels !== undefined ||
          b.kind !== undefined)
      )
        fail("Геометрия секции изменяется через редактор секции");
      if (
        !l.sectionId &&
        (b.kind === "rack" || (b.levels !== undefined && b.levels !== 1))
      )
        fail("Для стеллажа создайте секцию");
      const next = {
        ...l,
        ...changes,
        code: b.code?.trim() ?? l.code,
        name: b.name?.trim() ?? l.name,
      };
      const protectedPallets = s.pallets.filter(
        (p) =>
          p.status !== "retired" &&
          (p.locationId === id || p.returnLocationId === id),
      );
      const incomingPutaways = this._incomingPutaway(s, id);
      const targetMoves = s.movements.filter(
        (m) =>
          m.toLocationId === id && ["planned", "in_transit"].includes(m.status),
      );
      if (
        (protectedPallets.length ||
          targetMoves.length ||
          incomingPutaways.length) &&
        ((b.kind && b.kind !== l.kind) || b.blocked === true)
      )
        fail(
          "Нельзя менять тип или блокировать занятый/зарезервированный адрес",
        );
      for (const p of [
        ...protectedPallets,
        ...targetMoves.map((m) => find(s.pallets, m.palletId, "Паллета")),
      ]) {
        const problem = placementError(
          { ...s, locations: s.locations },
          next,
          p,
          p.id,
          targetMoves.find((m) => m.palletId === p.id)?.id,
          true,
        );
        if (problem) fail(problem);
      }
      for (const t of incomingPutaways) {
        const problem = putawayPlacementError(
          { ...s, locations: s.locations.map((l) => (l.id === id ? next : l)) },
          next,
          find(s.boxes, t.boxId, "Короб"),
          t.id,
        );
        if (problem) fail(problem);
      }
      if (
        targetMoves.some((m) => m.kind === "lower") &&
        (next.kind !== "picking" || next.accessSides !== 4)
      )
        fail("Спуск требует доступ с четырёх сторон");
      if (!l.sectionId && geometryChanged(l, next))
        checkRect(s, next, "location");
      Object.assign(l, next);
      activity(s, "Адрес обновлён", l.code, "location");
    });
  }
  private _deriveBalance(s: D.WorkspaceDto) {
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const rawUnits = sum(
      s.pallets
        .filter(
          (p) =>
            p.kind === "raw" && ["stored", "in_transit"].includes(p.status),
        )
        .map((p) => p.quantity),
    );
    const workInProgressUnits = sum(s.tasks.map((t) => t.scannedUnits));
    const boxedUnits = sum(
      s.boxes
        .filter((b) => ["stored", "in_transit"].includes(b.status))
        .map((b) => b.units),
    );
    const awaiting = s.pallets.filter((p) => p.status === "awaiting_placement");
    s.balance = {
      rawUnits,
      workInProgressUnits,
      boxedUnits,
      totalUnits: rawUnits + workInProgressUnits + boxedUnits,
      awaitingPlacementUnits: sum(awaiting.map((p) => p.quantity)),
      awaitingPlacementPallets: awaiting.length,
    };
  }
  private _receiptSku(
    s: D.WorkspaceDto,
    row: Pick<D.CreateReceiptPalletDto, "skuId" | "newSku">,
  ) {
    if ((row.skuId !== undefined) === (row.newSku !== undefined))
      fail("Укажите ровно одно: skuId или newSku");
    if (row.skuId !== undefined) return find(s.skus, row.skuId, "Тематика");
    const input = row.newSku!;
    if (
      !input ||
      typeof input.name !== "string" ||
      typeof input.barcode !== "string" ||
      (input.code !== undefined && typeof input.code !== "string") ||
      (input.unitsPerBox !== undefined &&
        (!Number.isInteger(input.unitsPerBox) ||
          input.unitsPerBox < 1 ||
          input.unitsPerBox > 1000))
    )
      fail("Некорректные параметры тематики");
    const name = input.name.trim(),
      barcode = input.barcode.trim(),
      code = input.code?.trim();
    if (!name || !barcode || code === "")
      fail("Название, штрихкод и код тематики не могут быть пустыми");
    if (name.length > 100 || barcode.length > 150 || (code?.length ?? 0) > 40)
      fail("Название, штрихкод или код тематики слишком длинные");
    const unitsPerBox = input.unitsPerBox ?? 20;
    const existing = s.skus.find((x) => x.barcode === barcode);
    if (existing) {
      if (
        existing.name !== name ||
        existing.unitsPerBox !== unitsPerBox ||
        (code !== undefined &&
          existing.code.toLocaleLowerCase() !== code.toLocaleLowerCase())
      )
        fail(
          "Штрихкод уже принадлежит другой тематике. Выберите существующую тематику",
        );
      return existing;
    }
    const skuCode = code ?? nextCode("SKU");
    if (
      s.skus.some(
        (x) => x.code.toLocaleLowerCase() === skuCode.toLocaleLowerCase(),
      )
    )
      fail("Код тематики уже существует");
    const sku: D.SkuDto = {
      id: randomUUID(),
      code: skuCode,
      name,
      barcode,
      unitsPerBox,
      color: "#6ee7b7",
      packaging: { ...DEMO_PACKAGING },
    };
    s.skus.push(sku);
    return sku;
  }
  createSku(b: D.CreateSkuDto) {
    return this._command("createSku", b, (s) => {
      const count = s.skus.length;
      const sku = this._receiptSku(s, { newSku: b });
      if (s.skus.length > count)
        activity(s, "Тематика создана", sku.name, "warehouse");
    });
  }
  createReceipt(b: D.CreateReceiptDto) {
    return this._command("createReceipt", b, (s) => {
      const timestamp = Date.parse(b.receivedAt);
      if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60 * 1000)
        fail(
          "Дата поступления должна быть корректной и не позднее текущего времени",
        );
      if (!b.pallets?.length || b.pallets.length > 100)
        fail("Приёмка должна содержать от 1 до 100 паллет");
      const receivedAt = new Date(timestamp).toISOString();
      const receipt: D.ReceiptDto = {
        id: randomUUID(),
        code: nextCode("RCV"),
        receivedAt,
        createdAt: now(),
        status: "awaiting_placement",
        completedAt: null,
        pallets: [],
      };
      for (const row of b.pallets) {
        const sku = this._receiptSku(s, row);
        const lot: D.LotDto = {
          id: randomUUID(),
          skuId: sku.id,
          receivedAt,
          name: `${receipt.code} · ${sku.name}`,
        };
        const pallet: D.PalletDto = {
          id: randomUUID(),
          code: nextCode("PLT"),
          skuId: sku.id,
          lotId: lot.id,
          kind: "raw",
          quantity: row.quantity,
          widthMm: row.widthMm ?? 1200,
          depthMm: row.depthMm ?? 800,
          heightMm: row.heightMm ?? 1400,
          weightKg: row.weightKg ?? null,
          locationId: null,
          status: "awaiting_placement",
          returnLocationId: null,
          packagingSnapshot: null,
        };
        s.lots.push(lot);
        s.pallets.push(pallet);
        receipt.pallets.push({
          palletId: pallet.id,
          skuId: sku.id,
          quantity: row.quantity,
          locationId: null,
          placedAt: null,
          placedByEmployeeId: null,
        });
      }
      s.receipts.push(receipt);
      activity(
        s,
        "Приёмка ожидает размещения",
        `${receipt.code} · ${receipt.pallets.length} паллет · на баланс после размещения`,
        "receipt",
      );
    });
  }
  private _pendingReceiptPallet(
    s: D.WorkspaceDto,
    id: string,
    palletId: string,
  ) {
    const receipt = find(s.receipts, id, "Приёмка");
    const row = receipt.pallets.find((p) => p.palletId === palletId);
    if (!row) fail("Паллета не принадлежит этой приёмке");
    const pallet = find(s.pallets, palletId, "Паллета");
    if (row.placedAt !== null || pallet.status !== "awaiting_placement")
      fail("Паллета уже размещена");
    return { receipt, row, pallet };
  }
  async getWorkRoute(query: D.WorkRouteQueryDto): Promise<D.WorkRouteDto> {
    validateWorkRouteQuery(query);
    const state = await this._readState("getWorkRoute");
    const context = requestAuth.getStore();
    return workRoute(state, query, context?.http ? context : undefined);
  }
  async getReceiptPlacementOptions(
    id: string,
    palletId: string,
  ): Promise<D.ReceiptPlacementOptionsDto> {
    const s = await this._readState(`getReceiptPlacementOptions/${id}`);
    const { pallet } = this._pendingReceiptPallet(s, id, palletId);
    const candidates = s.locations.filter(
      (l) =>
        ["rack", "floor"].includes(l.kind) && !placementError(s, l, pallet),
    );
    const ranked = rankPlacementLocations(
      s,
      candidates,
      receiptSourceLocation(s, id, palletId),
    );
    return {
      palletId,
      locations: ranked.locations,
      suggestedLocationId: ranked.suggestedLocationId,
      recommendation: ranked.recommendation,
      reason: candidates.length
        ? ranked.reason &&
          `${ranked.reason} Можно вручную подтвердить физически подходящий адрес сканом.`
        : "Нет свободного подходящего адреса хранения по габаритам, высоте и массе",
    };
  }
  placeReceiptPallet(id: string, palletId: string, b: D.PlaceReceiptPalletDto) {
    return this._command(`placeReceiptPallet/${id}/${palletId}`, b, (s) => {
      const { receipt, row, pallet } = this._pendingReceiptPallet(
        s,
        id,
        palletId,
      );
      const foreignClaim = s.warehouse.zoneWork.find(
        (w) =>
          w.jobKind === "receiving" &&
          w.jobId === id &&
          w.palletId === palletId &&
          w.employeeId !== b.employeeId,
      );
      if (foreignClaim)
        throw new ForbiddenException(
          "Паллета приёмки уже взята другим сотрудником",
        );

      if (find(s.employees, b.employeeId, "Сотрудник").status !== "working")
        fail("Для размещения сотрудник должен быть на смене");
      if (!this._scanEntity(b.palletCode, "pallet", pallet.id, pallet.code))
        fail("Неверный код паллеты приёмки");
      const location = s.locations.find((l) =>
        this._scanEntity(b.locationCode, "location", l.id, l.code),
      );
      if (!location) fail("Скан адреса не найден среди активных адресов");
      this._activeLocation(s, location.id);
      if (!["rack", "floor"].includes(location.kind))
        fail("Для приёмки нужен адрес хранения: стеллаж или напольное место");
      const problem = placementError(s, location, pallet);
      if (problem) fail(problem);
      const placedAt = now();
      pallet.status = "stored";
      pallet.locationId = location.id;
      row.locationId = location.id;
      row.placedAt = placedAt;
      row.placedByEmployeeId = b.employeeId;
      const completed = receipt.pallets.every((p) => p.placedAt !== null);
      receipt.status = completed ? "completed" : "partially_placed";
      receipt.completedAt = completed ? placedAt : null;
      activity(
        s,
        "Паллета размещена и зачислена на баланс",
        `${receipt.code} · ${pallet.code} · ${row.quantity} шт. → ${location.code}`,
        "receipt",
      );
      this._advanceZone(s, b.employeeId, "receiving", id, palletId);
    });
  }
  async getReceiptLabels(id: string): Promise<D.ReceiptLabelsDto> {
    const s = await this._readState(`getReceiptLabels/${id}`),
      receipt = find(s.receipts, id, "Приёмка");
    const labels = await Promise.all(
      receipt.pallets.map(async (row) => {
        const pallet = find(s.pallets, row.palletId, "Паллета");
        const payload = `artmate-wms:pallet:${pallet.id}`;
        return {
          palletId: pallet.id,
          code: pallet.code,
          title: find(s.skus, row.skuId, "Тематика").name,
          quantity: row.quantity,
          payload,
          svg: await QRCode.toString(payload, {
            type: "svg",
            margin: 2,
            width: 256,
          }),
        };
      }),
    );
    return {
      receiptCode: receipt.code,
      receivedAt: receipt.receivedAt,
      labels,
    };
  }
  createEmployee(b: D.CreateEmployeeDto) {
    return this._command("createEmployee", b, (s) => {
      const name = b.name.trim(),
        role = b.role?.trim() ?? "Сотрудник склада";
      if (!name || !role) fail("Имя и роль сотрудника не могут быть пустыми");
      if (
        s.employees.some(
          (e) => e.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        fail("Сотрудник с таким именем уже существует");
      s.employees.push({
        id: randomUUID(),
        name,
        initials: name
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => [...w][0])
          .join("")
          .toLocaleUpperCase(),
        role,
        status: "off",
        boxesToday: 0,
        unitsToday: 0,
      });
      activity(s, "Сотрудник добавлен", name, "employee");
    });
  }
  private _reserved(s: D.WorkspaceDto, palletId: string) {
    return s.tasks
      .filter((t) => t.status !== "completed")
      .flatMap((t) => t.reservations)
      .filter((r) => r.palletId === palletId)
      .reduce((sum, r) => sum + r.quantity, 0);
  }
  private _rawFifo(s: D.WorkspaceDto, skuId: string) {
    return s.pallets
      .filter(
        (p) =>
          p.kind === "raw" &&
          p.skuId === skuId &&
          p.quantity > 0 &&
          p.status === "stored" &&
          !!p.locationId &&
          this._isActiveLocation(s, p.locationId) &&
          !find(s.locations, p.locationId, "Адрес").blocked &&
          !s.movements.some(
            (m) =>
              m.palletId === p.id &&
              ["planned", "in_transit"].includes(m.status),
          ),
      )
      .sort(
        (a, b) =>
          find(s.lots, a.lotId!, "Партия").receivedAt.localeCompare(
            find(s.lots, b.lotId!, "Партия").receivedAt,
          ) || a.id.localeCompare(b.id),
      );
  }
  createTask(b: D.CreateTaskDto) {
    return this._command("createTask", b, (s) => {
      this._createAssemblyTask(s, b);
    });
  }
  async commitPlanningTask(
    tx: Queryable,
    before: D.WorkspaceDto,
    state: D.WorkspaceDto,
    body: D.CreateTaskDto,
  ): Promise<string> {
    if (requestAuth.getStore())
      await authorizeWarehouse(tx, "createTask", body, state);
    const taskId = this._createAssemblyTask(state, body);
    await this._commitState(tx, before, state, "createTask", body);
    return taskId;
  }
  private _createAssemblyTask(s: D.WorkspaceDto, b: D.CreateTaskDto): string {
    if (
      !Number.isInteger(b.boxesTarget) ||
      b.boxesTarget < 1 ||
      b.boxesTarget > 1000
    )
      fail("Количество коробов должно быть целым от 1 до 1000");
    const sku = find(s.skus, b.skuId, "Тематика");
    const employee = b.employeeId
      ? find(s.employees, b.employeeId, "Сотрудник")
      : null;
    const needed = b.boxesTarget * sku.unitsPerBox;
    let remaining = needed;
    const reservations: D.ReservationDto[] = [];
    for (const pallet of this._rawFifo(s, sku.id)) {
      const quantity = Math.min(
        remaining,
        pallet.quantity - this._reserved(s, pallet.id),
      );
      if (quantity > 0) {
        reservations.push({
          palletId: pallet.id,
          lotId: pallet.lotId!,
          quantity,
        });
        remaining -= quantity;
      }
      if (!remaining) break;
    }
    if (remaining)
      fail(
        `Недостаточно свободных раскрасок: нужно ${needed}, доступно ${needed - remaining}`,
      );
    const taskId = randomUUID();
    s.tasks.push({
      id: taskId,
      code: nextCode("TASK"),
      createdAt: now(),
      boxCodeConfirmed: false,
      skuId: sku.id,
      boxesTarget: b.boxesTarget,
      boxesCompleted: 0,
      unitsPerBox: sku.unitsPerBox,
      status: "queued",
      employeeId: employee?.id ?? null,
      scannedUnits: 0,
      sourcePalletId: null,
      openBoxCode: nextCode("BOX"),
      reservations,
      openBoxContents: [],
    });
    activity(
      s,
      "Создано задание",
      `${sku.name} · ${b.boxesTarget} коробов · FIFO зарезервирован`,
      "task",
    );
    return taskId;
  }
  private _taskSourcesError(s: D.WorkspaceDto, task: D.TaskDto): string | null {
    for (const r of task.reservations.filter((r) => r.quantity > 0)) {
      const p = s.pallets.find((p) => p.id === r.palletId);
      if (
        !p ||
        p.status !== "stored" ||
        !p.locationId ||
        p.quantity < r.quantity
      )
        return "Исходная паллета недоступна";
      const l = s.locations.find((l) => l.id === p.locationId);
      if (!l || !this._isActiveLocation(s, l.id) || l.blocked)
        return "Исходный адрес недоступен или заблокирован";
      if (
        s.movements.some(
          (m) =>
            m.palletId === p.id && ["planned", "in_transit"].includes(m.status),
        )
      )
        return "Исходная паллета в перемещении";
    }
    return null;
  }
  private _taskActor(s: D.WorkspaceDto, task: D.TaskDto, employeeId: string) {
    if (!employeeId || task.employeeId !== employeeId)
      fail("Задание выполняет другой сотрудник: нужен назначенный исполнитель");
    const employee = find(s.employees, employeeId, "Сотрудник");
    if (employee.status !== "working") fail("Сотрудник должен быть на смене");
    if (task.status !== "active") fail("Сначала возьмите и начните задание");
    return employee;
  }
  private _claimTask(s: D.WorkspaceDto, task: D.TaskDto, employeeId: string) {
    if (this._activePutaway(s, employeeId))
      fail(
        "Сначала завершите размещение короба или освободите взятое задание размещения",
      );
    const employee = find(s.employees, employeeId, "Сотрудник");
    if (employee.status !== "working") fail("Сотрудник должен быть на смене");
    if (!["queued", "paused"].includes(task.status))
      fail("Взять можно только ожидающее или своё приостановленное задание");
    if (task.employeeId && task.employeeId !== employeeId)
      fail("Задание назначено другому сотруднику");
    if (task.status === "paused" && task.employeeId !== employeeId)
      fail("Приостановленное задание должно быть назначено вам");
    if (
      s.tasks.some(
        (t) =>
          t.id !== task.id &&
          t.employeeId === employeeId &&
          t.status === "active",
      )
    )
      fail("У сотрудника уже есть активное задание");
    const problem = this._taskSourcesError(s, task);
    if (problem) fail(problem);
    task.employeeId = employeeId;
    task.status = "active";
    activity(s, "Сборка начата", `${task.code} · ${employee.name}`, "task");
  }
  claimTask(id: string, b: D.ClaimTaskDto) {
    return this._command(`claimTask/${id}`, b, (s) =>
      this._claimTask(s, find(s.tasks, id, "Задание"), b.employeeId),
    );
  }
  assignTask(id: string, b: D.AssignTaskDto) {
    return this._command(`assignTask/${id}`, b, (s) => {
      const task = find(s.tasks, id, "Задание");
      if (!["queued", "paused"].includes(task.status))
        fail("Назначение можно изменить только в очереди или после паузы");
      if (task.scannedUnits !== 0 || task.boxCodeConfirmed)
        fail("Закончите текущий короб перед изменением исполнителя");
      if (b.employeeId !== null) find(s.employees, b.employeeId, "Сотрудник");
      task.employeeId = b.employeeId;
      task.sourcePalletId = null;
      task.boxCodeConfirmed = false;
      if (b.employeeId === null) task.status = "queued";
      activity(
        s,
        "Назначение изменено",
        `${task.code} · ${b.employeeId === null ? "свободное задание" : find(s.employees, b.employeeId, "Сотрудник").name}`,
        "task",
      );
    });
  }
  updateTaskStatus(id: string, b: D.UpdateTaskStatusDto) {
    return this._command(`updateTaskStatus/${id}`, b, (s) => {
      const task = find(s.tasks, id, "Задание");
      if (b.status === "active") this._claimTask(s, task, b.employeeId);
      else {
        this._taskActor(s, task, b.employeeId);
        task.status = "paused";
        activity(s, "Сборка приостановлена", task.code, "task");
      }
    });
  }
  scanTask(id: string, b: D.ScanTaskDto) {
    return this._command(`scanTask/${id}`, b, async (s, tx) => {
      const task = find(s.tasks, id, "Задание");
      this._taskActor(s, task, b.employeeId);
      if (b.kind === "box") {
        await confirmBoxLabel(tx, task, b.value);
        if (task.boxCodeConfirmed) return;
        if (task.scannedUnits > 0)
          fail("Нельзя менять подтверждение начатого короба");
        const r = task.reservations.find((r) => r.quantity > 0);
        if (!r || task.sourcePalletId !== r.palletId)
          fail("Сначала отсканируйте исходную паллету");
        const problem = this._taskSourcesError(s, task);
        if (problem) fail(problem);
        task.boxCodeConfirmed = true;
        return;
      }
      if (task.scannedUnits >= task.unitsPerBox)
        fail("Короб заполнен. Завершите восстановление упаковки");
      const reservation = task.reservations.find((r) => r.quantity > 0);
      if (!reservation) fail("Резерв задания исчерпан");
      const problem = this._taskSourcesError(s, task);
      if (problem) fail(problem);
      const source = find(s.pallets, reservation.palletId, "Паллета");
      if (b.kind === "source") {
        const pallet = s.pallets.find(
          (p) =>
            p.id === b.value ||
            this._scanEntity(b.value, "pallet", p.id, p.code),
        );
        if (!pallet) fail("Паллета не найдена");
        if (pallet.id !== reservation.palletId)
          fail(`По FIFO нужна паллета ${source.code}`);
        task.sourcePalletId = pallet.id;
        return;
      }
      if (!task.boxCodeConfirmed)
        fail("Сначала отсканируйте код текущего короба");
      const sku = find(s.skus, task.skuId, "Тематика");
      if (b.value !== sku.barcode)
        fail(`Неверная тематика. Ожидается ${sku.name}`);
      if (task.sourcePalletId !== reservation.palletId)
        fail(`Отсканируйте исходную паллету ${source.code}`);
      if (source.quantity < 1) fail("На исходной паллете нет товара");
      source.quantity--;
      if (source.quantity === 0) {
        const address = s.locations.find((l) => l.id === source.locationId);
        source.status = "retired";
        source.locationId = null;
        source.returnLocationId = null;
        activity(
          s,
          "Адрес освобождён после сборки",
          `${source.code} · ${address?.code ?? "адрес хранения"}`,
          "task",
        );
      }
      reservation.quantity--;
      task.scannedUnits++;
      const content = task.openBoxContents.find(
        (c) => c.lotId === reservation.lotId,
      );
      if (content) content.quantity++;
      else task.openBoxContents.push({ lotId: reservation.lotId, quantity: 1 });
      if (!reservation.quantity) task.sourcePalletId = null;
      if (task.scannedUnits === task.unitsPerBox)
        this._packTask(s, task, b.employeeId);
    });
  }
  packTask(id: string, b: D.PackTaskDto) {
    return this._command(`packTask/${id}`, b, (s) => {
      const task = find(s.tasks, id, "Задание");
      this._taskActor(s, task, b.employeeId);
      if (
        b.boxCode !== task.openBoxCode &&
        b.boxCode !== `artmate-wms:box:${task.openBoxCode}`
      )
        fail("Отсканируйте код текущего короба");
      this._packTask(s, task, b.employeeId);
    });
  }
  private _packTask(s: D.WorkspaceDto, task: D.TaskDto, employeeId: string) {
    const employee = this._taskActor(s, task, employeeId);
    if (!task.boxCodeConfirmed)
      fail("Сначала отсканируйте код текущего короба");
    if (task.scannedUnits !== task.unitsPerBox)
      fail(
        `Нужно ${task.unitsPerBox} раскрасок, отсканировано ${task.scannedUnits}`,
      );
    const profile = find(s.skus, task.skuId, "Тематика").packaging;
    let pallet = s.pallets.find(
      (p) =>
        p.kind === "assembly" &&
        p.status === "stored" &&
        p.locationId &&
        this._isActiveLocation(s, p.locationId) &&
        find(s.locations, p.locationId, "Адрес").kind === "assembly",
    );
    const base = pallet?.packagingSnapshot ?? profile;
    const profiles = pallet
      ? s.boxes
          .filter((b) => b.palletId === pallet!.id && b.status === "stored")
          .map((b) => b.packagingSnapshot)
      : [];
    const metrics = assemblyMetrics(base, [...profiles, profile]);
    if (metrics.error) fail(metrics.error);
    if (pallet) {
      const problem = placementError(
        s,
        find(s.locations, pallet.locationId!, "Адрес"),
        { ...metrics, kind: "assembly" },
        pallet.id,
      );
      if (problem)
        fail(`${problem}. Разместите короба через второстепенные задания`);
    } else {
      const location = s.locations
        .filter(
          (l) =>
            l.kind === "assembly" &&
            (!s.warehouse.workZones.some(
              (z) => z.kind === "assembly" && !z.archived,
            ) ||
              l.id === canonicalAssemblyLocation(s)) &&
            !placementError(s, l, { ...metrics, kind: "assembly" }),
        )
        .sort((a, b) => a.code.localeCompare(b.code))[0];
      if (!location)
        fail("Создайте или освободите место типа «Сборка» на карте склада");
      pallet = {
        id: randomUUID(),
        code: nextCode("ASM"),
        skuId: null,
        lotId: null,
        kind: "assembly",
        status: "stored",
        locationId: location.id,
        returnLocationId: null,
        packagingSnapshot: structuredClone(base),
        quantity: 0,
        widthMm: base.palletWidthMm,
        depthMm: base.palletDepthMm,
        heightMm: base.palletBaseHeightMm,
        weightKg: base.palletWeightKg,
      };
      s.pallets.push(pallet);
    }
    s.boxes.push({
      id: randomUUID(),
      code: task.openBoxCode,
      skuId: task.skuId,
      units: task.unitsPerBox,
      lotContents: structuredClone(task.openBoxContents),
      packedAt: now(),
      locationId: pallet.locationId,
      palletId: pallet.id,
      status: "stored",
      packagingSnapshot: structuredClone(profile),
    });
    pallet.quantity++;
    this._recomputePallet(s, pallet);
    this._enqueuePutaway(s, s.boxes.at(-1)!);
    task.boxesCompleted++;
    employee.boxesToday++;
    employee.unitsToday += task.unitsPerBox;
    task.boxCodeConfirmed = false;
    task.sourcePalletId = null;
    task.scannedUnits = 0;
    task.openBoxContents = [];
    task.openBoxCode = nextCode("BOX");
    if (task.boxesCompleted === task.boxesTarget) {
      task.status = "completed";
      task.sourcePalletId = null;
    }
    activity(
      s,
      "Короб упакован",
      `${find(s.skus, task.skuId, "Тематика").name} · ${employee.name} · ${task.boxesCompleted}/${task.boxesTarget}`,
      "packing",
    );
    if (task.status === "completed") this._takeNextTask(s, employeeId);
  }
  private _takeNextTask(s: D.WorkspaceDto, employeeId: string) {
    const binding = s.warehouse.zoneWork.find(
      (w) => w.employeeId === employeeId,
    );
    if (binding) {
      const zone = s.warehouse.workZones.find(
        (z) => z.id === binding.zoneId && !z.archived,
      );
      if (zone?.kind === "assembly")
        this._chooseZoneWork(s, zone, employeeId, true);
      return;
    }

    if (this._activePutaway(s, employeeId)) return;
    if (
      s.tasks.some((t) => t.employeeId === employeeId && t.status === "active")
    )
      return;
    const candidates = s.tasks
      .filter(
        (t) =>
          t.status === "queued" &&
          (!t.employeeId || t.employeeId === employeeId) &&
          t.scannedUnits === 0 &&
          !t.boxCodeConfirmed,
      )
      .sort(
        (a, b) =>
          Number(b.employeeId === employeeId) -
            Number(a.employeeId === employeeId) ||
          (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
          a.id.localeCompare(b.id),
      );
    const next = candidates.find((t) => !this._taskSourcesError(s, t));
    if (!next) return;
    next.sourcePalletId = null;
    next.boxCodeConfirmed = false;
    this._claimTask(s, next, employeeId);
    activity(s, "Взято следующее задание", next.code, "task");
  }
  private _activePutaway(s: D.WorkspaceDto, employeeId: string) {
    return s.putawayTasks.find(
      (t) =>
        t.employeeId === employeeId &&
        ["claimed", "in_transit"].includes(t.status),
    );
  }
  private _incomingPutaway(s: D.WorkspaceDto, locationId: string) {
    return s.putawayTasks.filter(
      (t) =>
        t.toLocationId === locationId &&
        ["claimed", "in_transit"].includes(t.status),
    );
  }
  private _putawayPalletGuard(s: D.WorkspaceDto, p: D.PalletDto) {
    if (
      p.kind === "assembly" ||
      s.putawayTasks.some(
        (t) => t.fromPalletId === p.id && t.status !== "completed",
      )
    )
      fail(
        "Разместите короба по тематическим паллетам через второстепенные задания",
      );
    if (p.locationId && this._incomingPutaway(s, p.locationId).length)
      fail("Паллета назначения зарезервирована размещением коробов");
  }
  private _recomputePallet(s: D.WorkspaceDto, p: D.PalletDto) {
    const metrics =
      p.kind === "assembly"
        ? assemblyMetrics(
            p.packagingSnapshot!,
            s.boxes
              .filter((b) => b.palletId === p.id && b.status === "stored")
              .map((b) => b.packagingSnapshot),
          )
        : finishedMetrics(p.packagingSnapshot!, p.quantity);
    Object.assign(p, {
      widthMm: metrics.widthMm,
      depthMm: metrics.depthMm,
      heightMm: metrics.heightMm,
      weightKg: metrics.weightKg,
    });
  }
  private _enqueuePutaway(s: D.WorkspaceDto, box: D.BoxDto) {
    if (
      s.putawayTasks.some((t) => t.boxId === box.id && t.status !== "completed")
    )
      return;
    if (!box.palletId || !box.locationId) return;
    s.putawayTasks.push({
      id: randomUUID(),
      code: nextCode("PUT"),
      boxId: box.id,
      skuId: box.skuId,
      status: "queued",
      employeeId: null,
      fromPalletId: box.palletId,
      fromLocationId: box.locationId,
      toLocationId: null,
      createdAt: box.packedAt,
      claimedAt: null,
      takenAt: null,
      completedAt: null,
    });
  }
  private _enqueueMissingPutaways(s: D.WorkspaceDto) {
    for (const box of s.boxes.filter(
      (b) =>
        b.status === "stored" &&
        b.locationId &&
        find(s.locations, b.locationId, "Адрес").kind === "assembly",
    )) {
      const pallet = s.pallets.find(
        (p) => p.id === box.palletId && p.status === "stored",
      );
      if (
        pallet &&
        !s.movements.some(
          (m) =>
            m.palletId === pallet.id &&
            ["planned", "in_transit"].includes(m.status),
        )
      )
        this._enqueuePutaway(s, box);
    }
  }
  private _putawaySource(s: D.WorkspaceDto, t: D.PutawayTaskDto) {
    const box = find(s.boxes, t.boxId, "Короб"),
      pallet = find(s.pallets, t.fromPalletId, "Паллета");
    const location = this._activeLocation(s, t.fromLocationId);
    if (
      box.status !== "stored" ||
      box.palletId !== pallet.id ||
      box.locationId !== location.id ||
      pallet.status !== "stored" ||
      pallet.locationId !== location.id ||
      location.kind !== "assembly" ||
      location.blocked
    )
      fail("Короб недоступен на исходном месте сборки");
    if (
      s.movements.some(
        (m) =>
          m.palletId === pallet.id &&
          ["planned", "in_transit"].includes(m.status),
      )
    )
      fail("Исходная паллета участвует в перемещении");
    return { box, pallet, location };
  }
  private _putawayActor(
    s: D.WorkspaceDto,
    t: D.PutawayTaskDto,
    employeeId: string,
    status: string,
  ) {
    if (t.employeeId !== employeeId || !employeeId)
      fail("Задание размещения взял другой сотрудник");
    this._movementEmployee(s, employeeId);
    if (t.status !== status)
      fail(
        status === "claimed"
          ? "Сначала возьмите задание размещения"
          : "Сначала заберите короб",
      );
  }
  private _putawayOptions(
    s: D.WorkspaceDto,
    t: D.PutawayTaskDto,
  ): D.PutawayPlacementOptionsDto {
    const box = find(s.boxes, t.boxId, "Короб");
    const candidates = s.locations.filter(
      (l) => !putawayPlacementError(s, l, box, t.id),
    );
    // Once assigned, physical carry and its reserved destination are authoritative.
    // Read-only polling must never suggest a new address after a layout change.
    const fixed = ["claimed", "in_transit"].includes(t.status)
      ? t.toLocationId
      : null;
    const ranked = rankPlacementLocations(
      s,
      fixed ? s.locations.filter((l) => l.id === fixed) : candidates,
      t.fromLocationId,
      box.skuId,
    );
    return {
      boxId: box.id,
      locations: fixed
        ? [
            ...s.locations.filter((l) => l.id === fixed),
            ...candidates.filter((l) => l.id !== fixed),
          ]
        : ranked.locations,
      suggestedLocationId: fixed ?? ranked.suggestedLocationId,
      recommendation: ranked.recommendation,
      reason: fixed
        ? (putawayPlacementError(
            s,
            find(s.locations, fixed, "Адрес"),
            box,
            t.id,
          ) ?? ranked.reason)
        : candidates.length
          ? ranked.reason
          : "Нет подходящего адреса хранения с учётом тематики, профиля и входящих коробов",
    };
  }

  async getPutawayPlacementOptions(id: string) {
    const s = await this._readState(`getPutawayPlacementOptions/${id}`),
      t = find(s.putawayTasks, id, "Задание размещения");
    if (t.status === "completed") fail("Размещение уже завершено");
    return this._putawayOptions(s, t);
  }
  claimPutawayTask(id: string, b: D.ClaimPutawayTaskDto) {
    return this._command(`claimPutawayTask/${id}`, b, (s) => {
      this._claimPutaway(s, id, b.employeeId);
    });
  }
  private _claimPutaway(s: D.WorkspaceDto, id: string, employeeId: string) {
    const t = find(s.putawayTasks, id, "Задание размещения");
    if (t.status !== "queued")
      fail("Взять можно только свободное задание размещения");
    this._movementEmployee(s, employeeId);
    if (
      this._activePutaway(s, employeeId) ||
      s.tasks.some(
        (t) => t.employeeId === employeeId && t.status === "active",
      ) ||
      s.movements.some(
        (m) =>
          m.employeeId === employeeId &&
          ["planned", "in_transit"].includes(m.status),
      )
    )
      fail("Сначала завершите или приостановите текущее задание сотрудника");
    this._putawaySource(s, t);
    const options = this._putawayOptions(s, t);
    const target = options.suggestedLocationId;
    if (!target) fail(options.reason ?? "Нет подходящего адреса хранения");
    t.status = "claimed";
    t.employeeId = employeeId;
    t.toLocationId = target;
    t.claimedAt = now();
    activity(s, "Взято размещение короба", t.code, "putaway");
  }
  takePutawayTask(id: string, b: D.ConfirmPutawayTaskDto) {
    return this._command(`takePutawayTask/${id}`, b, (s) => {
      this._takePutawayBox(s, id, b.employeeId, b.boxCode, b.locationCode);
    });
  }
  takePutawayBox(id: string, b: D.TakePutawayBoxDto) {
    return this._command(`takePutawayBox/${id}`, b, (s) => {
      this._takePutawayBox(s, id, b.employeeId, b.boxCode);
    });
  }
  takeAnyPutawayBox(b: D.TakePutawayBoxDto) {
    return this._command("takeAnyPutawayBox", b, (s) => {
      this._movementEmployee(s, b.employeeId);
      const binding = s.warehouse.zoneWork.find(
        (w) => w.employeeId === b.employeeId,
      );
      const zone = s.warehouse.workZones.find((z) => z.id === binding?.zoneId);
      if (!zone || zone.archived || zone.kind !== "putaway")
        fail("Сначала отсканируйте QR зоны размещения");
      validateWorkZone(s, zone);
      const box = s.boxes.find((box) =>
        this._scanEntity(b.boxCode, "box", box.code, box.code),
      );
      if (!box) fail("Неизвестный короб. Отсканируйте QR готового короба");
      const task = s.putawayTasks.find(
        (t) => t.boxId === box.id && t.status !== "completed",
      );
      if (!task || !zone.locationIds.includes(task.fromLocationId))
        fail("Этот короб не ожидает размещения в текущей зоне");
      if (task.employeeId && task.employeeId !== b.employeeId)
        fail("Этот короб уже взял другой сотрудник");
      const current = this._activePutaway(s, b.employeeId);
      if (current?.status === "in_transit")
        fail("Сначала поставьте короб, который уже находится у вас");
      this._putawaySource(s, task);
      if (current && current.id !== task.id) this._releasePutaway(current);
      if (task.status === "queued")
        this._claimPutaway(s, task.id, b.employeeId);
      this._takePutawayBox(s, task.id, b.employeeId, b.boxCode);
      this._setZoneJob(
        s,
        zone,
        b.employeeId,
        "putaway",
        task.id,
        null,
        "Отсканируйте адрес назначения для короба у вас",
      );
    });
  }
  private _takePutawayBox(
    s: D.WorkspaceDto,
    id: string,
    employeeId: string,
    boxCode: string,
    locationCode?: string,
  ) {
    const t = find(s.putawayTasks, id, "Задание размещения");
    this._putawayActor(s, t, employeeId, "claimed");
    const { box, pallet, location } = this._putawaySource(s, t);
    if (
      !this._scanEntity(boxCode, "box", box.code, box.code) ||
      (locationCode !== undefined &&
        !this._scanEntity(locationCode, "location", location.id, location.code))
    )
      fail("Неверный код короба или исходного адреса");
    const target = this._activeLocation(s, t.toLocationId!);
    const problem = putawayPlacementError(s, target, box, t.id);
    if (problem) fail(problem);
    box.status = "in_transit";
    box.palletId = null;
    box.locationId = null;
    pallet.quantity--;
    this._recomputePallet(s, pallet);
    t.status = "in_transit";
    t.takenAt = now();
    activity(s, "Короб забран на размещение", box.code, "putaway");
  }
  placePutawayTask(id: string, b: D.ConfirmPutawayTaskDto) {
    return this._command(`placePutawayTask/${id}`, b, (s) => {
      this._placePutawayBox(s, id, b.employeeId, b.locationCode, b.boxCode);
    });
  }
  placePutawayBox(id: string, b: D.PlacePutawayBoxDto) {
    return this._command(`placePutawayBox/${id}`, b, (s) => {
      this._placePutawayBox(s, id, b.employeeId, b.locationCode);
    });
  }
  private _placePutawayBox(
    s: D.WorkspaceDto,
    id: string,
    employeeId: string,
    locationCode: string,
    boxCode?: string,
  ) {
    const t = find(s.putawayTasks, id, "Задание размещения");
    this._putawayActor(s, t, employeeId, "in_transit");
    const box = find(s.boxes, t.boxId, "Короб"),
      target = this._activeLocation(s, t.toLocationId!);
    if (
      (boxCode !== undefined &&
        !this._scanEntity(boxCode, "box", box.code, box.code)) ||
      !this._scanEntity(locationCode, "location", target.id, target.code)
    )
      fail("Неверный код короба или зарезервированного адреса");
    if (
      box.status !== "in_transit" ||
      box.palletId !== null ||
      box.locationId !== null
    )
      fail("Короб не находится у сотрудника");
    const problem = putawayPlacementError(s, target, box, t.id);
    if (problem) fail(problem);
    let pallet = s.pallets.find(
      (p) => p.status === "stored" && p.locationId === target.id,
    );
    if (!pallet) {
      const profile = box.packagingSnapshot;
      pallet = {
        id: randomUUID(),
        code: nextCode("FG"),
        skuId: box.skuId,
        lotId: null,
        kind: "finished",
        status: "stored",
        locationId: target.id,
        returnLocationId: null,
        packagingSnapshot: structuredClone(profile),
        quantity: 0,
        ...finishedMetrics(profile, 0),
      };
      s.pallets.push(pallet);
    }
    box.status = "stored";
    box.palletId = pallet.id;
    box.locationId = target.id;
    pallet.quantity++;
    this._recomputePallet(s, pallet);
    t.status = "completed";
    t.completedAt = now();
    activity(
      s,
      "Короб размещён на хранение",
      `${box.code} → ${target.code}`,
      "putaway",
    );
    this._advanceZone(s, employeeId, "putaway", id);
  }
  private _releasePutaway(t: D.PutawayTaskDto) {
    t.status = "queued";
    t.employeeId = null;
    t.toLocationId = null;
    t.claimedAt = null;
    t.takenAt = null;
    t.completedAt = null;
  }
  releasePutawayTask(id: string, b: D.ClaimPutawayTaskDto) {
    return this._command(`releasePutawayTask/${id}`, b, (s) => {
      const t = find(s.putawayTasks, id, "Задание размещения");
      this._putawayActor(s, t, b.employeeId, "claimed");
      this._releasePutaway(t);
      if (
        s.warehouse.zoneWork.some(
          (w) =>
            w.employeeId === b.employeeId &&
            w.jobKind === "putaway" &&
            w.jobId === id,
        )
      )
        this._clearZoneJob(
          s,
          b.employeeId,
          "Размещение освобождено. Отсканируйте зону для следующего задания",
        );
      activity(s, "Размещение возвращено в очередь", t.code, "putaway");
    });
  }
  private _boxFifo(s: D.WorkspaceDto, skuId: string) {
    return s.boxes
      .filter((b) => {
        const p = s.pallets.find((p) => p.id === b.palletId);
        const l = s.locations.find((l) => l.id === b.locationId);
        return (
          b.skuId === skuId &&
          b.status === "stored" &&
          p?.kind === "finished" &&
          p.status === "stored" &&
          !!l &&
          p.locationId === l.id &&
          this._isActiveLocation(s, l.id) &&
          !l.blocked &&
          l.kind !== "assembly" &&
          !s.putawayTasks.some(
            (t) => t.boxId === b.id && t.status !== "completed",
          ) &&
          !s.movements.some(
            (m) =>
              m.palletId === p.id &&
              ["planned", "in_transit"].includes(m.status),
          )
        );
      })
      .sort((a, b) => {
        const dates = (box: D.BoxDto) =>
          box.lotContents
            .map((c) => find(s.lots, c.lotId, "Партия").receivedAt)
            .sort();
        const ad = dates(a),
          bd = dates(b);
        return (
          ad[0].localeCompare(bd[0]) ||
          (ad.at(-1) ?? "").localeCompare(bd.at(-1) ?? "") ||
          a.packedAt.localeCompare(b.packedAt) ||
          a.code.localeCompare(b.code)
        );
      });
  }
  createShipment(b: D.CreateShipmentDto) {
    return this._command("createShipment", b, (s) => {
      const sku = find(s.skus, b.skuId, "Тематика");
      const reserved = new Set(
        s.shipments
          .filter((x) => x.status === "draft")
          .flatMap((x) => x.boxIds),
      );
      const boxes = this._boxFifo(s, sku.id)
        .filter((box) => !reserved.has(box.id))
        .slice(0, b.boxesRequested);
      if (boxes.length !== b.boxesRequested)
        fail(
          `Недостаточно готовых коробов: доступно ${boxes.length}, запрошено ${b.boxesRequested}`,
        );
      s.shipments.push({
        id: randomUUID(),
        code: nextCode("SHIP"),
        skuId: sku.id,
        boxesRequested: b.boxesRequested,
        status: "draft",
        boxIds: boxes.map((box) => box.id),
      });
      activity(
        s,
        "Отгрузка подготовлена",
        `${sku.name} · ${b.boxesRequested} коробов зарезервировано по FIFO`,
        "shipment",
      );
    });
  }
  shipShipment(id: string, b: D.CommandDto) {
    return this._command(`shipShipment/${id}`, b, (s) => {
      const shipment = find(s.shipments, id, "Отгрузка");
      if (shipment.employeeId)
        fail(
          "Отгрузка взята сотрудником. Завершите её по сканам на рабочем месте",
        );
      this._shipShipment(s, id);
    });
  }
  private _shipShipment(s: D.WorkspaceDto, id: string) {
    const shipment = find(s.shipments, id, "Отгрузка");
    if (shipment.status === "shipped") fail("Отгрузка уже выполнена");
    for (const boxId of shipment.boxIds) {
      const box = find(s.boxes, boxId, "Короб");
      if (box.status !== "stored") fail("Короб уже отгружен");
      if (
        s.putawayTasks.some(
          (t) => t.boxId === box.id && t.status !== "completed",
        ) ||
        (box.locationId &&
          find(s.locations, box.locationId, "Адрес").kind === "assembly") ||
        s.pallets.find((p) => p.id === box.palletId)?.kind !== "finished"
      )
        fail("Сначала разместите короб с общей паллеты на хранение");
      const sourcePallet = box.palletId
        ? find(s.pallets, box.palletId, "Паллета")
        : null;
      if (
        !box.locationId ||
        sourcePallet?.status !== "stored" ||
        this._activeLocation(s, box.locationId).blocked ||
        !["picking", "shipping"].includes(
          this._activeLocation(s, box.locationId).kind,
        )
      )
        fail(
          "Сначала подтвердите перемещение паллеты в зону отбора или отгрузки",
        );
      if (
        s.movements.some(
          (m) =>
            m.palletId === box.palletId &&
            ["planned", "in_transit"].includes(m.status),
        )
      )
        fail("Завершите перемещение перед отгрузкой");

      box.status = "shipped";
      if (box.palletId) {
        const pallet = find(s.pallets, box.palletId, "Паллета");
        pallet.quantity--;
        Object.assign(
          pallet,
          finishedMetrics(pallet.packagingSnapshot!, pallet.quantity),
        );
      }
    }
    shipment.status = "shipped";
    activity(
      s,
      "Отгрузка завершена",
      `${shipment.code} · ${shipment.boxesRequested} коробов. Остаток паллет сохранён.`,
      "shipment",
    );
  }
  private _addLevel(
    s: D.WorkspaceDto,
    section: D.RackSectionDto,
    b: D.RackLevelInputDto,
  ) {
    this._uniqueLocationCode(s, b.code);
    if (!b.name.trim()) fail("Укажите название яруса");
    const level =
      Math.max(
        0,
        ...s.locations
          .filter((l) => l.sectionId === section.id)
          .map((l) => l.level),
      ) + 1;
    if (level > 20) fail("В секции допускается не более 20 адресов");
    s.locations.push({
      id: randomUUID(),
      code: b.code.trim(),
      name: b.name.trim(),
      kind: "rack",
      rotation: section.rotation,
      archived: false,
      archivedAt: null,
      sectionId: section.id,
      level,
      levels: 1,
      x: section.x,
      y: section.y,
      width: section.width,
      depth: section.depth,
      maxHeightMm: b.maxHeightMm,
      maxBoxes: b.maxBoxes,
      availableWidthMm: b.availableWidthMm,
      availableDepthMm: b.availableDepthMm,
      maxWeightKg: b.maxWeightKg ?? null,
      accessSides: b.accessSides ?? 1,
      blocked: false,
    });
  }
  createRackSection(b: D.CreateRackSectionDto) {
    return this._command("createRackSection", b, (s) => {
      if (!b.code.trim() || !b.name.trim())
        fail("Укажите код и название секции");
      if (
        s.sections.some(
          (x) => x.code.toLowerCase() === b.code.trim().toLowerCase(),
        )
      )
        fail("Код секции уже существует");
      const section = {
        id: randomUUID(),
        code: b.code.trim(),
        name: b.name.trim(),
        rotation: b.rotation ?? 0,
        archived: false,
        archivedAt: null,
        archivedLocationIds: [],
        x: b.x,
        y: b.y,
        width: b.width,
        depth: b.depth,
      };
      checkRect(s, section, "section");
      s.sections.push(section);
      for (const level of b.levels) this._addLevel(s, section, level);
      activity(
        s,
        "Создана секция",
        `${section.code} · ${b.levels.length} адресов`,
        "location",
      );
    });
  }
  copyRackSection(id: string, b: D.CopyRackSectionDto) {
    return this._command(`copyRackSection/${id}`, b, (s) => {
      const source = this._activeSection(s, id);
      const levels = s.locations
        .filter((l) => l.sectionId === id && !l.archived)
        .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
      if (!levels.length) fail("В секции нет активных ярусов для копирования");
      if (levels.length > 20)
        fail("В копии секции допускается не более 20 активных ярусов");
      const identity = generateSectionIdentity(s.sections, s.locations);
      const section: D.RackSectionDto = {
        id: randomUUID(),
        ...identity,
        x: b.x,
        y: b.y,
        width: source.width,
        depth: source.depth,
        rotation: source.rotation,
        archived: false,
        archivedAt: null,
        archivedLocationIds: [],
      };
      checkRect(s, section, "section");
      s.sections.push(section);
      for (const [index, level] of levels.entries()) {
        const number = index + 1;
        s.locations.push({
          id: randomUUID(),
          code: `${section.code}-${String(number).padStart(2, "0")}`,
          name: `${section.name} · Ярус ${number}`,
          kind: "rack",
          sectionId: section.id,
          level: number,
          levels: 1,
          x: section.x,
          y: section.y,
          width: section.width,
          depth: section.depth,
          rotation: section.rotation,
          archived: false,
          archivedAt: null,
          maxHeightMm: level.maxHeightMm,
          maxBoxes: level.maxBoxes,
          availableWidthMm: level.availableWidthMm,
          availableDepthMm: level.availableDepthMm,
          maxWeightKg: level.maxWeightKg,
          accessSides: level.accessSides,
          blocked: level.blocked,
        });
      }
      checkPlanState(s);
      activity(
        s,
        "Секция скопирована",
        `${source.code} → ${section.code} · ${levels.length} ярусов · без товара`,
        "location",
      );
    });
  }
  updateRackSection(id: string, b: D.UpdateRackSectionDto) {
    return this._command(`updateRackSection/${id}`, b, (s) => {
      const section = this._activeSection(s, id);
      const { requestId, ...changes } = this._definedChanges(b);
      if (b.code !== undefined) {
        if (!b.code.trim()) fail("Укажите код секции");
        if (
          s.sections.some(
            (x) =>
              x.id !== id &&
              x.code.toLowerCase() === b.code!.trim().toLowerCase(),
          )
        )
          fail("Код секции уже существует");
        changes.code = b.code.trim();
      }
      if (b.name !== undefined) {
        if (!b.name.trim()) fail("Укажите название секции");
        changes.name = b.name.trim();
      }
      const next = { ...section, ...changes };
      if (geometryChanged(section, next)) checkRect(s, next, "section");
      Object.assign(section, changes);
      for (const l of s.locations.filter((l) => l.sectionId === id))
        Object.assign(l, {
          x: section.x,
          y: section.y,
          width: section.width,
          depth: section.depth,
          rotation: section.rotation,
        });
      activity(s, "Секция обновлена", section.code, "location");
    });
  }
  createRackLevel(id: string, b: D.CreateRackLevelDto) {
    return this._command(`createRackLevel/${id}`, b, (s) => {
      this._addLevel(s, this._activeSection(s, id), b);
      activity(s, "Добавлен адрес яруса", b.code, "location");
    });
  }
  updateSkuPackaging(id: string, b: D.UpdateSkuPackagingDto) {
    return this._command(`updateSkuPackaging/${id}`, b, (s) => {
      const sku = find(s.skus, id, "Тематика");
      const problem = packagingError(b.packaging);
      if (problem) fail(problem);
      if (s.tasks.some((t) => t.skuId === id && t.status !== "completed"))
        fail(
          "Сначала завершите задания этой тематики: их профиль упаковки менять нельзя",
        );
      sku.packaging = structuredClone(b.packaging);
      activity(
        s,
        "Профиль упаковки обновлён",
        `${sku.name} · закрытые короба и паллеты сохраняют прежние габариты`,
        "packaging",
      );
    });
  }
  private _movementEmployee(s: D.WorkspaceDto, id: string) {
    if (find(s.employees, id, "Сотрудник").status !== "working")
      fail("Для перемещения сотрудник должен быть на смене");
  }
  private _scanEntity(value: string, type: string, id: string, code: string) {
    return value === code || value === `artmate-wms:${type}:${id}`;
  }
  createMovement(b: D.CreateMovementDto) {
    return this._command("createMovement", b, (s) => {
      const pallet = find(s.pallets, b.palletId, "Паллета");
      this._movementEmployee(s, b.employeeId);
      if (this._activePutaway(s, b.employeeId))
        fail("Сначала завершите размещение короба");
      this._putawayPalletGuard(s, pallet);
      if (pallet.status !== "stored" || !pallet.locationId)
        fail("Паллета не находится на хранении");
      if (
        s.movements.some(
          (m) =>
            m.palletId === pallet.id &&
            ["planned", "in_transit"].includes(m.status),
        )
      )
        fail("У паллеты уже есть активное перемещение");
      if (pallet.kind === "raw" && this._reserved(s, pallet.id) > 0)
        fail("Исходная паллета зарезервирована заданиями сборки");
      this._activeLocation(s, pallet.locationId);
      const target = this._activeLocation(s, b.toLocationId);
      if (target.id === pallet.locationId)
        fail("Источник и назначение должны отличаться");
      if (
        b.kind === "lower" &&
        (target.kind !== "picking" || target.accessSides !== 4)
      )
        fail("Для спуска нужен адрес picking с доступом с четырёх сторон");
      if (b.kind === "transfer" && pallet.returnLocationId === target.id)
        fail("Для этого адреса оформите возврат");
      if (
        b.kind === "return" &&
        pallet.returnLocationId &&
        pallet.returnLocationId !== target.id
      )
        fail("Возврат разрешён только на сохранённый исходный адрес");
      if (
        b.kind === "return" &&
        !pallet.returnLocationId &&
        !["rack", "floor"].includes(target.kind)
      )
        fail("Без сохранённого адреса возврат разрешён в rack или floor");
      if (pallet.returnLocationId && b.kind === "lower")
        fail(
          "Нельзя повторно спустить паллету до возврата на сохранённый адрес",
        );
      if (b.keepSourceReserved && b.kind !== "lower")
        fail("Сохранять источник можно только при спуске");
      const problem = placementError(s, target, pallet, pallet.id);
      if (problem) fail(problem);
      const keepSourceReserved =
        b.kind === "lower" ? (b.keepSourceReserved ?? true) : false;
      s.movements.push({
        id: randomUUID(),
        code: nextCode("MOVE"),
        palletId: pallet.id,
        fromLocationId: pallet.locationId,
        toLocationId: target.id,
        kind: b.kind,
        status: "planned",
        employeeId: b.employeeId,
        keepSourceReserved,
        createdAt: now(),
        takenAt: null,
        completedAt: null,
      });
      activity(
        s,
        "Перемещение запланировано",
        `${pallet.code} → ${target.code}`,
        "movement",
      );
    });
  }
  takeMovement(id: string, b: D.ConfirmMovementDto) {
    return this._command(`takeMovement/${id}`, b, (s) => {
      const m = find(s.movements, id, "Перемещение");
      if (m.status !== "planned")
        fail("Забрать можно только запланированную паллету");
      this._movementEmployee(s, m.employeeId);
      const pallet = find(s.pallets, m.palletId, "Паллета");
      this._putawayPalletGuard(s, pallet);
      if (this._activePutaway(s, m.employeeId))
        fail("Сначала завершите размещение короба");
      const source = this._activeLocation(s, m.fromLocationId);
      if (
        !this._scanEntity(b.palletCode, "pallet", pallet.id, pallet.code) ||
        !this._scanEntity(b.locationCode, "location", source.id, source.code)
      )
        fail("Неверный код паллеты или исходного адреса");
      if (pallet.status !== "stored" || pallet.locationId !== source.id)
        fail("Паллета уже перемещена");
      if (pallet.kind === "raw" && this._reserved(s, pallet.id) > 0)
        fail("Паллета зарезервирована сборкой");
      const problem = placementError(
        s,
        this._activeLocation(s, m.toLocationId),
        pallet,
        pallet.id,
        m.id,
      );
      if (problem) fail(problem);
      pallet.locationId = null;
      pallet.status = "in_transit";
      if (m.kind === "lower" && m.keepSourceReserved)
        pallet.returnLocationId = source.id;
      for (const box of s.boxes)
        if (box.palletId === pallet.id && box.status === "stored")
          box.locationId = null;
      m.status = "in_transit";
      m.takenAt = now();
      activity(
        s,
        "Паллета забрана",
        `${pallet.code} · ${source.code}`,
        "movement",
      );
    });
  }
  placeMovement(id: string, b: D.ConfirmMovementDto) {
    return this._command(`placeMovement/${id}`, b, (s) => {
      const m = find(s.movements, id, "Перемещение");
      if (m.status !== "in_transit") fail("Сначала подтвердите забор паллеты");
      this._movementEmployee(s, m.employeeId);
      const pallet = find(s.pallets, m.palletId, "Паллета");
      const target = this._activeLocation(s, m.toLocationId);
      if (
        !this._scanEntity(b.palletCode, "pallet", pallet.id, pallet.code) ||
        !this._scanEntity(b.locationCode, "location", target.id, target.code)
      )
        fail("Неверный код паллеты или целевого адреса");
      if (pallet.status !== "in_transit" || pallet.locationId !== null)
        fail("Паллета не в пути");
      if (
        m.kind === "lower" &&
        (target.kind !== "picking" || target.accessSides !== 4)
      )
        fail("Спуск требует доступ с четырёх сторон");
      const problem = placementError(s, target, pallet, pallet.id, m.id);
      if (problem) fail(problem);
      pallet.locationId = target.id;
      pallet.status = "stored";
      if (m.kind === "return") pallet.returnLocationId = null;
      for (const box of s.boxes)
        if (box.palletId === pallet.id && box.status === "stored")
          box.locationId = target.id;
      m.status = "completed";
      m.completedAt = now();
      if (target.kind === "assembly") this._enqueueMissingPutaways(s);
      activity(
        s,
        "Паллета размещена",
        `${pallet.code} → ${target.code}`,
        "movement",
      );
    });
  }
  cancelMovement(id: string, b: D.CommandDto) {
    return this._command(`cancelMovement/${id}`, b, (s) => {
      const m = find(s.movements, id, "Перемещение");
      if (m.status !== "planned")
        fail("Отменить можно только перемещение до забора паллеты");
      m.status = "cancelled";
      activity(s, "Перемещение отменено", m.code, "movement");
    });
  }
  retireEmptyPallet(id: string, b: D.RetireEmptyPalletDto) {
    return this._command(`retireEmptyPallet/${id}`, b, (s) => {
      const p = find(s.pallets, id, "Паллета");
      if (p.status !== "stored" || !p.locationId)
        fail("Для вывоза паллета должна стоять на известном адресе");
      if (
        p.quantity !== 0 ||
        s.boxes.some((box) => box.palletId === id && box.status === "stored")
      )
        fail("Вывоз разрешён только для полностью пустой паллеты");
      if (
        s.movements.some(
          (m) =>
            m.palletId === id && ["planned", "in_transit"].includes(m.status),
        )
      )
        fail("Сначала завершите или отмените перемещение");
      const l = this._activeLocation(s, p.locationId);
      if (this._incomingPutaway(s, l.id).length)
        fail("Паллета назначения зарезервирована размещением коробов");
      if (
        !this._scanEntity(b.palletCode, "pallet", p.id, p.code) ||
        !this._scanEntity(b.locationCode, "location", l.id, l.code)
      )
        fail("Неверный код паллеты или адреса вывоза");
      p.status = "retired";
      p.locationId = null;
      p.returnLocationId = null;
      activity(
        s,
        "Пустая паллета вывезена",
        `${p.code} · ${l.code}`,
        "movement",
      );
    });
  }
  updateShift(id: string, b: D.UpdateShiftDto) {
    return this._command(`updateShift/${id}`, b, (s) => {
      const employee = find(s.employees, id, "Сотрудник");
      if (!["working", "break", "off"].includes(b.status))
        fail("Неизвестный статус смены");
      if (employee.status === b.status) return;
      if (employee.status === "off" && b.status === "break")
        fail("Сначала начните смену");
      if (b.status !== "working") {
        if (
          s.movements.some(
            (m) => m.employeeId === id && m.status === "in_transit",
          )
        )
          fail(
            "Сначала разместите паллету: нельзя прервать смену с паллетой в пути",
          );
        if (
          s.putawayTasks.some(
            (t) => t.employeeId === id && t.status === "in_transit",
          )
        )
          fail(
            "Сначала разместите короб: нельзя закончить смену с коробом в руках",
          );
        for (const t of s.putawayTasks.filter(
          (t) => t.employeeId === id && t.status === "claimed",
        ))
          this._releasePutaway(t);
      }
      if (b.status !== "working") {
        const binding = s.warehouse.zoneWork.find((w) => w.employeeId === id);
        if (binding && ["receiving", "putaway"].includes(binding.jobKind ?? ""))
          this._clearZoneJob(
            s,
            id,
            "Работа приостановлена. После возобновления смены отсканируйте зону",
          );
      }
      employee.status = b.status;
      if (b.status !== "working")
        for (const task of s.tasks)
          if (task.employeeId === id && task.status === "active")
            task.status = "paused";
      activity(
        s,
        b.status === "working"
          ? "Смена начата"
          : b.status === "break"
            ? "Сотрудник на перерыве"
            : "Смена завершена",
        employee.name,
        "employee",
      );
    });
  }
  createWorkZone(b: D.CreateWorkZoneDto) {
    return this._command("createWorkZone", b, (s) => {
      const zone: D.WorkZoneDto = {
        id: randomUUID(),
        ...zoneIdentity(s, b.kind, b.code, b.name),
        kind: b.kind,
        locationIds: [...b.locationIds],
        archived: false,
        archivedAt: null,
      };
      validateWorkZone(s, zone);
      s.warehouse.workZones.push(zone);
      activity(s, "Рабочая зона создана", zone.name, "warehouse");
    });
  }
  updateWorkZone(id: string, b: D.UpdateWorkZoneDto) {
    return this._command(`updateWorkZone/${id}`, b, (s) => {
      const zone = find(s.warehouse.workZones, id, "Рабочая зона");
      if (zone.archived) fail("Сначала восстановите рабочую зону");
      const changes = Object.fromEntries(
        Object.entries(b).filter(
          ([k, v]) => k !== "requestId" && v !== undefined,
        ),
      );
      if (
        (b.kind !== undefined && b.kind !== zone.kind) ||
        (b.locationIds !== undefined &&
          JSON.stringify(b.locationIds) !== JSON.stringify(zone.locationIds))
      )
        this._zoneEditGuard(s, id);
      if (
        b.code !== undefined &&
        s.warehouse.workZones.some(
          (z) =>
            z.id !== id &&
            z.code.trim().toLowerCase() === b.code!.trim().toLowerCase(),
        )
      )
        fail("Код рабочей зоны уже используется, включая архив");
      if (
        (b.code !== undefined && !b.code.trim()) ||
        (b.name !== undefined && !b.name.trim())
      )
        fail("Укажите непустые код и название рабочей зоны");
      if (b.code !== undefined) changes.code = b.code.trim();
      if (b.name !== undefined) changes.name = b.name.trim();
      Object.assign(zone, changes);
      validateWorkZone(s, zone);
      activity(s, "Рабочая зона обновлена", zone.name, "warehouse");
    });
  }
  archiveWorkZone(id: string, b: D.CommandDto) {
    return this._command(`archiveWorkZone/${id}`, b, (s) => {
      const z = find(s.warehouse.workZones, id, "Рабочая зона");
      if (z.archived) fail("Рабочая зона уже в архиве");
      this._zoneEditGuard(s, id);
      z.archived = true;
      z.archivedAt = now();
      s.warehouse.zoneWork = s.warehouse.zoneWork.filter(
        (w) => w.zoneId !== id,
      );
      activity(s, "Рабочая зона в архиве", z.name, "warehouse");
    });
  }
  restoreWorkZone(id: string, b: D.CommandDto) {
    return this._command(`restoreWorkZone/${id}`, b, (s) => {
      const z = find(s.warehouse.workZones, id, "Рабочая зона");
      if (!z.archived) fail("Рабочая зона уже активна");
      validateWorkZone(s, z);
      z.archived = false;
      z.archivedAt = null;
      activity(s, "Рабочая зона восстановлена", z.name, "warehouse");
    });
  }
  private _zoneEditGuard(s: D.WorkspaceDto, id: string) {
    if (
      s.warehouse.zoneWork.some(
        (w) => w.zoneId === id && this._zoneJobActive(s, w),
      )
    )
      fail(
        "В рабочей зоне есть незавершённые задания. Сначала завершите работу или выйдите из зоны",
      );
  }
  private _zoneJobActive(s: D.WorkspaceDto, w: D.ZoneWorkDto) {
    if (w.jobKind === "assembly")
      return s.tasks.some(
        (t) =>
          t.id === w.jobId &&
          t.employeeId === w.employeeId &&
          t.status !== "completed",
      );
    if (w.jobKind === "putaway")
      return s.putawayTasks.some(
        (t) =>
          t.id === w.jobId &&
          t.employeeId === w.employeeId &&
          ["claimed", "in_transit"].includes(t.status),
      );
    if (w.jobKind === "receiving")
      return s.receipts.some(
        (r) =>
          r.id === w.jobId &&
          r.pallets.some((p) => p.palletId === w.palletId && !p.placedAt),
      );
    if (w.jobKind === "shipping")
      return s.shipments.some(
        (x) =>
          x.id === w.jobId &&
          x.employeeId === w.employeeId &&
          x.status === "draft",
      );
    return false;
  }
  private _assertZoneIntegrity(s: D.WorkspaceDto) {
    const zones = s.warehouse.workZones,
      bindings = s.warehouse.zoneWork;
    if (
      new Set(zones.map((z) => z.id)).size !== zones.length ||
      new Set(zones.map((z) => z.code.trim().toLowerCase())).size !==
        zones.length
    )
      fail("Идентичность рабочих зон должна быть уникальной");
    for (const z of zones.filter((z) => !z.archived))
      validateWorkZone(s, z, false);
    if (new Set(bindings.map((w) => w.employeeId)).size !== bindings.length)
      fail("У сотрудника может быть только одна рабочая зона");
    const receiptClaims = new Set<string>();
    for (const w of bindings) {
      find(s.employees, w.employeeId, "Сотрудник зоны");
      const z = find(zones, w.zoneId, "Рабочая зона");
      if (z.archived)
        fail("Нельзя сохранять назначение в архивной рабочей зоне");
      if (w.jobKind && w.jobKind !== z.kind)
        fail("Назначение не соответствует виду рабочей зоны");
      if (w.jobKind === "receiving" && this._zoneJobActive(s, w)) {
        const key = `${w.jobId}/${w.palletId}`;
        if (receiptClaims.has(key))
          fail("Паллета приёмки взята несколькими сотрудниками");
        receiptClaims.add(key);
      }
    }
    for (const shipment of s.shipments) {
      const scanned = shipment.scannedBoxIds ?? [];
      if (
        new Set(scanned).size !== scanned.length ||
        scanned.some((id) => !shipment.boxIds.includes(id))
      )
        fail("Подтверждённый короб не принадлежит отгрузке");
      if (scanned.length && !shipment.employeeId)
        fail("У подтверждённых коробов отгрузки должен быть исполнитель");
      if (shipment.employeeId)
        find(s.employees, shipment.employeeId, "Исполнитель отгрузки");
    }
  }
  private _readWorkZone(s: D.WorkspaceDto, code: string) {
    const prefix = "artmate-wms:work-zone:";
    if (!code.startsWith(prefix))
      fail("Отсканируйте QR рабочей зоны, а не адреса хранения");
    const zone = find(
      s.warehouse.workZones,
      code.slice(prefix.length),
      "Рабочая зона",
    );
    if (zone.archived) fail("Рабочая зона находится в архиве");
    validateWorkZone(s, zone);
    return zone;
  }
  private _clearZoneJob(
    s: D.WorkspaceDto,
    employeeId: string,
    message: string,
  ) {
    const w = s.warehouse.zoneWork.find((w) => w.employeeId === employeeId);
    if (w)
      Object.assign(w, { jobKind: null, jobId: null, palletId: null, message });
  }
  private _setZoneJob(
    s: D.WorkspaceDto,
    z: D.WorkZoneDto,
    employeeId: string,
    kind: string | null,
    id: string | null,
    palletId: string | null,
    message: string,
  ) {
    let w = s.warehouse.zoneWork.find((w) => w.employeeId === employeeId);
    const next = {
      employeeId,
      zoneId: z.id,
      jobKind: kind,
      jobId: id,
      palletId,
      message,
    };
    if (w) Object.assign(w, next);
    else s.warehouse.zoneWork.push(next);
    return next;
  }
  private _leaveWork(s: D.WorkspaceDto, employeeId: string) {
    if (
      s.movements.some(
        (m) => m.employeeId === employeeId && m.status === "in_transit",
      ) ||
      s.putawayTasks.some(
        (t) => t.employeeId === employeeId && t.status === "in_transit",
      )
    )
      fail("Сначала подтвердите размещение товара в пути");
    const tasks = s.tasks.filter(
      (t) => t.employeeId === employeeId && t.status !== "completed",
    );
    if (tasks.some((t) => t.scannedUnits > 0 || t.boxCodeConfirmed))
      fail(
        "Сначала завершите текущий короб. Менять рабочую зону можно между коробами",
      );
    const shipments = s.shipments.filter(
      (x) => x.employeeId === employeeId && x.status === "draft",
    );
    if (shipments.some((x) => (x.scannedBoxIds ?? []).length > 0))
      fail("Сначала завершите отгрузку с уже подтверждёнными коробами");
    for (const t of tasks) {
      if (t.status === "active") t.status = "paused";
      t.sourcePalletId = null;
    }
    for (const t of s.putawayTasks.filter(
      (t) => t.employeeId === employeeId && t.status === "claimed",
    ))
      this._releasePutaway(t);
    for (const shipment of shipments) {
      shipment.employeeId = null;
      shipment.workZoneId = null;
      shipment.scannedBoxIds = [];
    }
    s.warehouse.zoneWork = s.warehouse.zoneWork.filter(
      (w) => w.employeeId !== employeeId,
    );
  }
  startZoneWork(b: D.StartZoneWorkDto) {
    return this._command("startZoneWork", b, (s) => {
      this._movementEmployee(s, b.employeeId);
      const zone = this._readWorkZone(s, b.zoneCode),
        current = s.warehouse.zoneWork.find(
          (w) => w.employeeId === b.employeeId,
        );
      const carryMovement = s.movements.some(
        (m) => m.employeeId === b.employeeId && m.status === "in_transit",
      );
      if (carryMovement) fail("Сначала подтвердите размещение паллеты в пути");
      const carry = s.putawayTasks.find(
        (t) => t.employeeId === b.employeeId && t.status === "in_transit",
      );
      const resumeUnbound =
        !current &&
        ((zone.kind === "assembly" &&
          s.tasks.some(
            (t) =>
              t.employeeId === b.employeeId &&
              t.status !== "completed" &&
              (t.scannedUnits > 0 || t.boxCodeConfirmed),
          )) ||
          (zone.kind === "putaway" &&
            !!carry &&
            zone.locationIds.includes(carry.fromLocationId)) ||
          (zone.kind === "shipping" &&
            s.shipments.some(
              (x) =>
                x.employeeId === b.employeeId &&
                x.status === "draft" &&
                x.workZoneId === zone.id,
            )));
      if (
        carry &&
        (zone.kind !== "putaway" ||
          !zone.locationIds.includes(carry.fromLocationId) ||
          (current && current.zoneId !== zone.id))
      )
        fail("Сначала подтвердите размещение короба в пути");
      if (current?.zoneId !== zone.id && !resumeUnbound)
        this._leaveWork(s, b.employeeId);
      this._chooseZoneWork(s, zone, b.employeeId);
      activity(
        s,
        "Рабочая зона отсканирована",
        `${zone.name} · ${find(s.employees, b.employeeId, "Сотрудник").name}`,
        "work-zone",
      );
    });
  }
  leaveZoneWork(b: D.ClaimTaskDto) {
    return this._command("leaveZoneWork", b, (s) => {
      this._leaveWork(s, b.employeeId);
      activity(
        s,
        "Рабочая зона освобождена",
        find(s.employees, b.employeeId, "Сотрудник").name,
        "work-zone",
      );
    });
  }
  private _chooseZoneWork(
    s: D.WorkspaceDto,
    zone: D.WorkZoneDto,
    employeeId: string,
    automatic = false,
  ) {
    const assign = (
      kind: string,
      id: string,
      palletId: string | null,
      message: string,
    ) => this._setZoneJob(s, zone, employeeId, kind, id, palletId, message);
    const idle = (message: string) =>
      this._setZoneJob(s, zone, employeeId, null, null, null, message);
    if (zone.kind === "assembly") {
      const own = s.tasks
        .filter(
          (t) =>
            t.employeeId === employeeId &&
            ["active", "paused"].includes(t.status),
        )
        .sort(
          (a, b) =>
            Number(b.status === "active") - Number(a.status === "active") ||
            Number(b.scannedUnits > 0 || b.boxCodeConfirmed) -
              Number(a.scannedUnits > 0 || a.boxCodeConfirmed) ||
            (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
            a.id.localeCompare(b.id),
        )[0];
      if (own) {
        const sourceError = this._taskSourcesError(s, own);
        if (automatic && own.status === "paused" && sourceError) {
          idle(`Следующее своё задание пока недоступно: ${sourceError}`);
          return;
        }
        if (own.status !== "active") this._claimTask(s, own, employeeId);
        assign("assembly", own.id, null, "Продолжите своё задание сборки");
        return;
      }
      const candidates = s.tasks
        .filter(
          (t) =>
            t.status === "queued" &&
            (!t.employeeId || t.employeeId === employeeId) &&
            !t.scannedUnits &&
            !t.boxCodeConfirmed,
        )
        .sort(
          (a, b) =>
            Number(b.employeeId === employeeId) -
              Number(a.employeeId === employeeId) ||
            (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
            a.id.localeCompare(b.id),
        );
      const t = candidates.find((t) => !this._taskSourcesError(s, t));
      if (t) {
        this._claimTask(s, t, employeeId);
        assign("assembly", t.id, null, "Задание сборки взято в работу");
      } else
        idle(
          "Нет доступных заданий сборки. Руководитель может создать новое задание",
        );
    } else if (zone.kind === "receiving") {
      const current = s.warehouse.zoneWork.find(
        (w) =>
          w.employeeId === employeeId &&
          w.zoneId === zone.id &&
          w.jobKind === "receiving" &&
          this._zoneJobActive(s, w),
      );
      if (current) return;
      const claims = new Set(
        s.warehouse.zoneWork
          .filter(
            (w) =>
              w.employeeId !== employeeId &&
              w.jobKind === "receiving" &&
              this._zoneJobActive(s, w),
          )
          .map((w) => `${w.jobId}/${w.palletId}`),
      );
      for (const r of [...s.receipts]
        .filter((r) => r.status !== "completed")
        .sort(
          (a, b) =>
            a.receivedAt.localeCompare(b.receivedAt) ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ))
        for (const row of [...r.pallets].sort((a, b) =>
          a.palletId.localeCompare(b.palletId),
        )) {
          const p = s.pallets.find((p) => p.id === row.palletId);
          if (
            row.placedAt ||
            !p ||
            p.status !== "awaiting_placement" ||
            claims.has(`${r.id}/${p.id}`)
          )
            continue;
          if (
            !s.locations.some(
              (l) =>
                ["rack", "floor"].includes(l.kind) && !placementError(s, l, p),
            )
          )
            continue;
          assign(
            "receiving",
            r.id,
            p.id,
            "Разместите выбранную входящую паллету по сканам",
          );
          return;
        }
      idle("Нет свободных входящих паллет с доступным местом хранения");
    } else if (zone.kind === "putaway") {
      const own = this._activePutaway(s, employeeId);
      if (own) {
        if (!zone.locationIds.includes(own.fromLocationId))
          fail("Ваше размещение относится к другой рабочей зоне");
        assign("putaway", own.id, null, "Продолжите размещение своего короба");
        return;
      }
      idle("Возьмите любой готовый короб и отсканируйте его QR");
    } else if (zone.kind === "shipping") {
      const own = s.shipments.find(
        (x) => x.employeeId === employeeId && x.status === "draft",
      );
      if (own) {
        if (own.workZoneId !== zone.id)
          fail("Ваша отгрузка относится к другой рабочей зоне");
        assign(
          "shipping",
          own.id,
          null,
          "Продолжите подтверждать короба своей отгрузки",
        );
        return;
      }
      const draft = s.shipments
        .filter((x) => x.status === "draft" && !x.employeeId)
        .sort(
          (a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
        )
        .find((x) => !this._shipmentWorkError(s, x, zone));
      if (draft) {
        draft.employeeId = employeeId;
        draft.workZoneId = zone.id;
        draft.scannedBoxIds = [];
        assign(
          "shipping",
          draft.id,
          null,
          "Отсканируйте каждый зарезервированный короб и подтвердите отгрузку",
        );
      } else
        idle(
          "Нет готовых отгрузок у адресов зоны. Сначала переместите зарезервированные паллеты в зону отбора или отгрузки",
        );
    }
  }
  private _advanceZone(
    s: D.WorkspaceDto,
    employeeId: string,
    kind: string,
    id: string,
    palletId?: string,
  ) {
    const w = s.warehouse.zoneWork.find(
      (w) =>
        w.employeeId === employeeId &&
        w.jobKind === kind &&
        w.jobId === id &&
        (!palletId || w.palletId === palletId),
    );
    if (!w) return;
    const z = s.warehouse.workZones.find(
      (z) => z.id === w.zoneId && !z.archived,
    );
    if (!z) return;
    this._clearZoneJob(s, employeeId, "Выбираем следующее задание");
    this._chooseZoneWork(s, z, employeeId, true);
  }
  private _shipmentWorkError(
    s: D.WorkspaceDto,
    x: D.ShipmentDto,
    z: D.WorkZoneDto,
  ): string | null {
    for (const id of x.boxIds) {
      const b = s.boxes.find((b) => b.id === id),
        p = s.pallets.find((p) => p.id === b?.palletId),
        l = b?.locationId ? activeZoneLocation(s, b.locationId) : null;
      if (
        !b ||
        b.status !== "stored" ||
        !p ||
        p.kind !== "finished" ||
        p.status !== "stored" ||
        !l ||
        p.locationId !== l.id ||
        l.blocked ||
        !["picking", "shipping"].includes(l.kind) ||
        !z.locationIds.includes(l.id)
      )
        return "Сначала переместите все зарезервированные паллеты к адресам этой зоны отгрузки";
      if (
        s.putawayTasks.some(
          (t) => t.boxId === id && t.status !== "completed",
        ) ||
        s.movements.some(
          (m) =>
            m.palletId === p.id && ["planned", "in_transit"].includes(m.status),
        )
      )
        return "Завершите размещение и перемещения перед отгрузкой";
    }
    return null;
  }
  private _shipmentWorkActor(
    s: D.WorkspaceDto,
    id: string,
    employeeId: string,
  ) {
    this._movementEmployee(s, employeeId);
    if (
      s.movements.some(
        (m) => m.employeeId === employeeId && m.status === "in_transit",
      ) ||
      s.putawayTasks.some(
        (t) => t.employeeId === employeeId && t.status === "in_transit",
      )
    )
      fail("Сначала подтвердите размещение товара в пути");
    const shipment = find(s.shipments, id, "Отгрузка");
    if (shipment.employeeId !== employeeId)
      throw new ForbiddenException("Отгрузка взята другим сотрудником");
    if (shipment.status !== "draft") fail("Отгрузка уже завершена");
    const zone = find(
      s.warehouse.workZones,
      shipment.workZoneId!,
      "Рабочая зона",
    );
    if (zone.archived || zone.kind !== "shipping")
      fail("Рабочая зона отгрузки недоступна");
    const binding = s.warehouse.zoneWork.find(
      (w) =>
        w.employeeId === employeeId &&
        w.zoneId === zone.id &&
        w.jobKind === "shipping" &&
        w.jobId === id,
    );
    if (!binding) fail("Сначала отсканируйте рабочую зону своей отгрузки");
    const error = this._shipmentWorkError(s, shipment, zone);
    if (error) fail(error);
    return { shipment, zone };
  }
  scanShipmentWork(id: string, b: D.ScanShipmentWorkDto) {
    return this._command(`scanShipmentWork/${id}`, b, (s) => {
      const { shipment } = this._shipmentWorkActor(s, id, b.employeeId);
      const box = shipment.boxIds
        .map((id) => find(s.boxes, id, "Короб"))
        .find((box) => this._scanEntity(b.boxCode, "box", box.code, box.code));
      if (!box) fail("Короб не входит в резерв этой отгрузки");
      shipment.scannedBoxIds ??= [];
      if (shipment.scannedBoxIds.includes(box.id))
        fail("Этот короб уже подтверждён. Отсканируйте следующий");
      shipment.scannedBoxIds.push(box.id);
    });
  }
  finishShipmentWork(id: string, b: D.FinishShipmentWorkDto) {
    return this._command(`finishShipmentWork/${id}`, b, (s) => {
      const { shipment, zone } = this._shipmentWorkActor(s, id, b.employeeId),
        scanned = new Set(shipment.scannedBoxIds ?? []);
      if (this._readWorkZone(s, b.zoneCode).id !== zone.id)
        fail("Отсканирован QR другой зоны отгрузки");
      if (
        shipment.boxIds.some((id) => !scanned.has(id)) ||
        scanned.size !== shipment.boxIds.length
      )
        fail("Сначала подтвердите каждый зарезервированный короб");
      this._shipShipment(s, id);
      this._advanceZone(s, b.employeeId, "shipping", id);
    });
  }
  async getLabel(type: string, id: string): Promise<D.LabelDto> {
    const s = await this.snapshot();
    let code = "",
      title = "",
      payload = "";
    if (type === "work-zone") {
      const z = find(s.warehouse.workZones, id, "Рабочая зона");
      code = z.code;
      const purpose: Record<string, string> = {
        receiving: "Приёмка",
        assembly: "Сборка",
        putaway: "Размещение",
        shipping: "Отгрузка",
      };
      title = `${z.archived ? "Архив · " : ""}${purpose[z.kind]} · ${z.name}`;
      payload = `artmate-wms:work-zone:${z.id}`;
    } else if (type === "location") {
      const l = find(s.locations, id, "Место");
      code = l.code;
      title = this._isActiveLocation(s, id) ? l.name : `Архив · ${l.name}`;
      payload = `artmate-wms:location:${l.id}`;
    } else if (type === "pallet") {
      const p = find(s.pallets, id, "Паллета");
      code = p.code;
      title =
        p.kind === "assembly"
          ? "Общая паллета сборки"
          : find(s.skus, p.skuId!, "Тематика").name;
      payload = `artmate-wms:pallet:${p.id}`;
    } else if (type === "box") {
      const box = s.boxes.find((b) => b.id === id || b.code === id);
      const task = s.tasks.find((t) => t.openBoxCode === id);
      if (!box && !task) throw new NotFoundException("Короб не найден");
      code = box?.code ?? task!.openBoxCode;
      title = find(s.skus, (box ?? task)!.skuId, "Тематика").name;
      payload = `artmate-wms:box:${code}`;
    } else
      throw new BadRequestException(
        "Тип метки: location, pallet, box или work-zone",
      );
    return {
      code,
      title,
      payload,
      svg: await QRCode.toString(payload, {
        type: "svg",
        margin: 2,
        width: 256,
      }),
    };
  }
  async onModuleDestroy() {
    await this.ready;
    await this.tail;
    await this.db.close();
  }
}
