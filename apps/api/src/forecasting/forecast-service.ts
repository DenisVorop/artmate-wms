import { overlayForecastChartHistory } from "./chart-history";
import {
  appendForecastChartDays,
  readForecastChartDays,
} from "./chart-history-storage";
import { captureForecastJournal, forecastJournalScopes } from "./journal-types";
import {
  appendForecastJournal,
  listForecastJournal,
  readForecastJournal,
  readForecastJournalFeedback,
} from "./journal-storage";
import { compareForecastJournal } from "./journal-comparison";
import type { ForecastJournalQueryDto } from "./journal-dto";
import { activeMarketplaceResolutions } from "../marketplaces/planning-resolutions";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { validateSync } from "class-validator";
import { WarehouseService } from "../warehouse.service";
import type { Queryable } from "../database";
import { requireAuth } from "../auth-policy";
import { requestAuth } from "../auth-context";
import {
  loadMarketplaces,
  type MarketplaceState,
} from "../marketplaces/storage";
import { loadForecastHistorySeries } from "./history-storage";
import {
  baselineForecastOverview,
  type ForecastComputeInput,
} from "./forecast-projection";
import { computeForecastInWorker } from "./forecast-worker";
import {
  forecastAsOf,
  forecastDay,
  forecastCache,
  forecastLease,
  forecastInputKey,
  forecastPolicies,
  forecastSkus,
  putForecast,
  FORECAST_COMPUTATION_LEASE_MS,
  type ForecastCache,
} from "./forecast-storage";
import { ForecastOverviewDto, UpdateForecastPolicyDto } from "./forecast-dto";

type Compute = (
  input: ForecastComputeInput,
  signal?: AbortSignal,
) => Promise<ForecastCache>;
@Injectable()
export class ForecastService {
  private readonly compute: Compute = computeForecastInWorker;
  private readonly clock = () => new Date();
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  static forTesting(
    warehouse: WarehouseService,
    compute: Compute,
    clock = () => new Date(),
  ) {
    const service = new ForecastService(warehouse);
    Object.assign(service, { compute, clock });
    return service;
  }
  private async _manager(tx: Queryable, write = false) {
    const actor = await requireAuth(tx, write);
    if (actor.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
    return actor;
  }
  private async _input(
    tx: Queryable,
    m?: MarketplaceState,
  ): Promise<ForecastComputeInput> {
    m ??= await loadMarketplaces(tx);
    const skus = await forecastSkus(tx),
      policies = await forecastPolicies(tx, skus),
      clock = this.clock();
    return {
      key: await forecastInputKey(tx, m, skus, policies, clock),
      asOf: forecastAsOf(clock),
      generatedAt: clock.toISOString(),
      skus,
      policies,
      settings: m.settings,
      mappings: m.mappings,
      resolutions: activeMarketplaceResolutions(m, clock),
      connections: m.connections
        .filter((c) => c.enabled)
        .map((c) => ({
          provider: c.provider,
          storeId: c.historyStoreId ?? null,
          version: c.version,
        })),
      snapshots: m.snapshots.filter((s) =>
        m!.connections.some((c) => c.enabled && c.provider === s.provider),
      ),
      series: [],
    };
  }
  private async _overview(tx: Queryable): Promise<ForecastOverviewDto> {
    const input = await this._input(tx),
      cache = await forecastCache(tx),
      lease = await forecastLease(tx);
    const computing =
      !!lease && Date.parse(lease.until) > this.clock().getTime();
    if (cache?.key === input.key) {
      const scopeKeys = forecastJournalScopes(input).map((s) => s.scopeKey),
        active = new Set(scopeKeys),
        historyKeys = (cache.chartIdentities ?? [])
          .filter((identity) => active.has(identity.scopeKey))
          .map((identity) => identity.historyKey),
        saved = await readForecastChartDays(tx, historyKeys, input.asOf);
      return {
        ...overlayForecastChartHistory(cache, saved, scopeKeys, input.asOf),
        computing,
      };
    }
    const failed = (
      await tx.query<{ payload: { key: string } }>(
        "SELECT payload FROM forecast_results WHERE id=$1",
        ["failure"],
      )
    ).rows[0]?.payload;
    if (!computing && failed?.key === input.key)
      return {
        ...baselineForecastOverview(input),
        computing: false,
        message:
          "Не удалось обновить прогноз. Пока используется средний спрос; повторим автоматически.",
      };
    return { ...baselineForecastOverview(input), computing: true };
  }
  getForecastOverview() {
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      return this._overview(tx);
    });
  }
  getForecastJournal(query: ForecastJournalQueryDto = {}) {
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      const input = await this._input(tx);
      return listForecastJournal(tx, {
        ...query,
        scopeKeys: forecastJournalScopes(input).map((s) => s.scopeKey),
      });
    });
  }
  getForecastJournalRun(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new BadRequestException("Некорректный номер прогноза");
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      const input = await this._input(tx),
        scopeKeys = forecastJournalScopes(input).map((s) => s.scopeKey),
        run = await readForecastJournal(tx, id, scopeKeys);
      if (!run) throw new NotFoundException("Сохранённый прогноз не найден");
      const history = await loadForecastHistorySeries(
        tx,
        input.mappings,
        forecastDay(this.clock()),
      );
      return compareForecastJournal(run, history, input.asOf, scopeKeys);
    });
  }
  async updateForecastPolicy(body: UpdateForecastPolicyDto) {
    if (
      validateSync(Object.assign(new UpdateForecastPolicyDto(), body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length
    )
      throw new BadRequestException("Проверьте настройки прогноза");
    return this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "forecast/updatePolicy",
            actor.id,
            body.requestId,
            body.skuId,
            body.minimumBoxes,
            body.seasonalityEnabled,
          ]),
        )
        .digest("hex");
      const other = await tx.query(
        "SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM automation_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM pallet_label_commands WHERE request_id=$1",
        [body.requestId],
      );
      if (other.rows.length)
        throw new ConflictException(
          "Этот requestId уже использован для другой операции",
        );
      const previous = await tx.query<{
        fingerprint: string;
        response: ForecastOverviewDto;
      }>("SELECT fingerprint,response FROM commands WHERE request_id=$1", [
        body.requestId,
      ]);
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== fingerprint)
          throw new ConflictException(
            "Этот requestId уже использован для другой операции",
          );
        return previous.rows[0].response;
      }
      if (!(await forecastSkus(tx)).some((s) => s.id === body.skuId))
        throw new BadRequestException("Тематика не найдена");
      await putForecast(tx, "forecast_policies", body.skuId, {
        skuId: body.skuId,
        minimumBoxes: body.minimumBoxes,
        seasonalityEnabled: body.seasonalityEnabled,
      });
      const response = await this._overview(tx);
      await tx.query(
        "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
        [body.requestId, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  /** Internal scheduler boundary: cannot borrow a human request's authority. */
  async runForecastComputation(
    signal?: AbortSignal,
  ): Promise<"updated" | "skipped" | "superseded" | "failed"> {
    if (requestAuth.getStore()?.http)
      throw new ForbiddenException("Фоновый расчёт недоступен через HTTP");
    if (signal?.aborted) return "skipped";
    const start = await this.warehouse.authTransaction(async (tx) => {
      const input = await this._input(tx),
        cache = await forecastCache(tx),
        lease = await forecastLease(tx);
      if (
        cache?.key === input.key ||
        (lease && Date.parse(lease.until) > this.clock().getTime())
      )
        return null;
      const runId = randomUUID();
      await putForecast(tx, "forecast_results", "lease", {
        key: input.key,
        runId,
        until: new Date(
          this.clock().getTime() + FORECAST_COMPUTATION_LEASE_MS,
        ).toISOString(),
      });
      input.series = await loadForecastHistorySeries(
        tx,
        input.mappings,
        forecastDay(this.clock()),
      );
      input.journalRuns = await readForecastJournalFeedback(
        tx,
        forecastJournalScopes(input).map((s) => s.scopeKey),
        input.asOf,
      );
      return { input, runId };
    });
    if (!start) return "skipped";
    try {
      if (signal?.aborted) {
        await this._release(start.runId);
        return "skipped";
      }
      const result = await this.compute(start.input, signal);
      if (signal?.aborted) {
        await this._release(start.runId);
        return "skipped";
      }
      return await this.warehouse.authTransaction(async (tx) => {
        const lease = await forecastLease(tx),
          current = await this._input(tx);
        if (lease?.runId !== start.runId) return "superseded" as const;
        if (current.key !== start.input.key || result.key !== start.input.key) {
          await tx.query("DELETE FROM forecast_results WHERE id=$1", ["lease"]);
          return "superseded" as const;
        }
        if (signal?.aborted) throw new Error("Forecast stopped");
        const journal = captureForecastJournal(
          start.input,
          result,
          this.clock().toISOString(),
        );
        if (await appendForecastJournal(tx, journal))
          await appendForecastChartDays(tx, journal);
        await putForecast(tx, "forecast_results", "current", result);
        await tx.query("DELETE FROM forecast_results WHERE id=$1", ["lease"]);
        await tx.query("DELETE FROM forecast_results WHERE id=$1", ["failure"]);
        if (signal?.aborted) throw new Error("Forecast stopped");
        return "updated" as const;
      });
    } catch {
      await this._release(
        start.runId,
        signal?.aborted ? undefined : start.input.key,
      );
      return signal?.aborted ? "skipped" : "failed";
    }
  }
  private async _release(runId: string, failedKey?: string) {
    await this.warehouse.authTransaction(async (tx) => {
      if ((await forecastLease(tx))?.runId === runId) {
        await tx.query("DELETE FROM forecast_results WHERE id=$1", ["lease"]);
        if (failedKey)
          await putForecast(tx, "forecast_results", "failure", {
            key: failedKey,
          });
      }
    });
  }
}
