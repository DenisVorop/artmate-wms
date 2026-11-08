import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { validateSync } from "class-validator";
import { WarehouseService } from "../warehouse.service";
import type { Queryable } from "../database";
import type { WorkspaceDto } from "../dto";
import { requestAuth } from "../auth-context";
import { requireAuth } from "../auth-policy";
import { loadMarketplaces } from "../marketplaces/storage";
import { marketplacePlan } from "../marketplaces/planning";
import { readForecastPlanContext } from "../forecasting/forecast-storage";
import { assemblyPressure } from "./assembly-pressure";
import {
  WorkAutomationStatusDto,
  UpdateWorkAutomationSettingsDto,
} from "./dto";
import {
  automaticPlanningWorkspace,
  automaticTaskIntents,
  untouchedAutomaticTask,
} from "./planning";
import { rawAccessMovementIntents } from "./raw-access";
import {
  automationOrigins,
  automationRuntime,
  automationSettings,
  saveAutomationOrigin,
  saveAutomationSetting,
} from "./storage";
import type { AutomaticTaskIntent, AutomaticTaskOrigin } from "./types";
interface AutomationDependencies {
  clock: () => Date;
  forecast: typeof readForecastPlanContext;
  plan: typeof marketplacePlan;
  pressure: typeof assemblyPressure;
}
@Injectable()
export class WorkAutomationService {
  private readonly dependencies: AutomationDependencies = {
    clock: () => new Date(),
    forecast: readForecastPlanContext,
    plan: marketplacePlan,
    pressure: assemblyPressure,
  };
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  static forTesting(
    warehouse: WarehouseService,
    dependencies: Partial<AutomationDependencies> = {},
  ) {
    const service = new WorkAutomationService(warehouse);
    Object.assign(service.dependencies, dependencies);
    return service;
  }
  private async _manager(tx: Queryable, write = false) {
    const actor = await requireAuth(tx, write);
    if (actor.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
    return actor;
  }
  private async _status(
    tx: Queryable,
    workspace?: WorkspaceDto,
  ): Promise<WorkAutomationStatusDto> {
    const settings = await automationSettings(tx),
      runtime = await automationRuntime(tx);
    const state = workspace ?? (await this.warehouse.stocktakeState(tx));
    const pressure = this.dependencies.pressure(state);
    return {
      enabled: settings.enabled,
      lastCheckedAt: runtime.lastCheckedAt,
      queuedAssemblyTasks: state.tasks.filter(
        (task) => task.status === "queued" && task.employeeId === null,
      ).length,
      queuedPutawayTasks: state.putawayTasks.filter(
        (task) => task.status === "queued",
      ).length,
      assemblyBoxes: pressure.boxes,
      assemblyCapacityBoxes: pressure.capacityBoxes,
      pressure: pressure.level,
      message: !settings.enabled
        ? "Автопланирование на паузе. Уже взятые задания продолжаются."
        : ["full", "unavailable"].includes(pressure.level)
          ? pressure.message
          : runtime.message,
      blockers: [
        ...new Set([
          ...runtime.blockers,
          ...(["full", "unavailable"].includes(pressure.level)
            ? [pressure.message]
            : []),
        ]),
      ],
    };
  }
  async getWorkAutomation() {
    return this.warehouse.authTransaction(async (tx) => {
      await this._manager(tx);
      return this._status(tx);
    });
  }
  async updateWorkAutomationSettings(body: UpdateWorkAutomationSettingsDto) {
    if (
      validateSync(Object.assign(new UpdateWorkAutomationSettingsDto(), body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).length ||
      !body.requestId.trim()
    )
      throw new BadRequestException("Проверьте настройки автопланирования");
    return this.warehouse.authTransaction(async (tx) => {
      const actor = await this._manager(tx, true);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "work-automation/settings",
            actor.id,
            body.requestId,
            body.enabled,
          ]),
        )
        .digest("hex");
      const other = await tx.query(
        "SELECT request_id FROM commands WHERE request_id=$1 UNION ALL SELECT request_id FROM stocktake_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM box_label_commands WHERE request_id=$1 UNION ALL SELECT request_id FROM pallet_label_commands WHERE request_id=$1",
        [body.requestId],
      );
      if (other.rows.length)
        throw new ConflictException(
          "Этот requestId уже использован для другой операции",
        );
      const previous = (
        await tx.query<{
          fingerprint: string;
          response: WorkAutomationStatusDto;
        }>(
          "SELECT fingerprint,response FROM automation_commands WHERE request_id=$1",
          [body.requestId],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException(
            "Этот requestId уже использован для другой операции",
          );
        return previous.response;
      }
      await saveAutomationSetting(tx, "common", {
        enabled: body.enabled,
        updatedAt: this.dependencies.clock().toISOString(),
        actorAccountId: actor.id,
      });
      const response = await this._status(tx);
      await tx.query(
        "INSERT INTO automation_commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
        [body.requestId, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  async runWorkAutomation(
    signal?: AbortSignal,
  ): Promise<"updated" | "skipped"> {
    if (requestAuth.getStore()?.http)
      throw new ForbiddenException(
        "Автопланирование недоступно из HTTP-запроса",
      );
    if (signal?.aborted) return "skipped";
    return this.warehouse.authTransaction(async (tx) => {
      signal?.throwIfAborted();
      const clock = this.dependencies.clock(),
        checkedAt = clock.toISOString();
      const settings = await automationSettings(tx);
      if (!settings.enabled) return "skipped";
      const state = await this.warehouse.stocktakeState(tx);
      const previousRevision = state.revision;
      // Missing placement work is recovered independently of forecast readiness.
      await this.warehouse.applyAutomaticTasks(tx, state, []);
      signal?.throwIfAborted();
      const opening = await tx.query(
        "SELECT id FROM stocktakes WHERE payload->>'mode'='opening' AND payload->>'status' NOT IN ('approved','cancelled') LIMIT 1",
      );
      if (opening.rows.length) {
        await saveAutomationSetting(tx, "runtime", {
          lastCheckedAt: checkedAt,
          message:
            "Идёт первичная инвентаризация. Сначала завершите ввод начальных остатков.",
          blockers: [
            "Утвердите или отмените открытые документы первичного ввода.",
          ],
        });
        signal?.throwIfAborted();
        return state.revision !== previousRevision ? "updated" : "skipped";
      }
      const origins = await automationOrigins(tx);
      // Re-slotting works from physical inventory, even while the sales forecast
      // is refreshing. Only untouched automatic assembly reservations may yield.
      const counting = await tx.query<{ location_id: string }>(
        "SELECT DISTINCT r.location_id FROM stocktake_rows r JOIN stocktakes d ON d.id=r.document_id WHERE d.payload->>'status' NOT IN ('approved','cancelled')",
      );
      const demandSkuIds = state.tasks
        .filter((task) => task.status !== "completed")
        .sort(
          (a, b) =>
            Number(a.autoPurpose === "backlog") -
              Number(b.autoPurpose === "backlog") ||
            (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
            a.id.localeCompare(b.id),
        )
        .map((task) => task.skuId);
      const moves = rawAccessMovementIntents(
        automaticPlanningWorkspace(state, origins),
        {
          blockedLocationIds: new Set(
            counting.rows.map((row) => row.location_id),
          ),
          demandSkuIds,
        },
      );
      const movingSkus = new Set(
        moves.flatMap((intent) =>
          intent.kind === "create"
            ? [
                state.pallets.find((pallet) => pallet.id === intent.palletId)!
                  .skuId,
              ]
            : [],
        ),
      );
      const release: AutomaticTaskIntent[] = state.tasks
        .filter(
          (task) =>
            movingSkus.has(task.skuId) && untouchedAutomaticTask(task, origins),
        )
        .map((task) => ({
          kind: "withdraw",
          taskId: task.id,
          reason:
            "Сначала спустите сырьё на доступный ярус. Сборка будет пересчитана после размещения.",
        }));
      if (release.length) {
        const previous = new Map(
          state.tasks.map((task) => [task.id, structuredClone(task)]),
        );
        await this.warehouse.applyAutomaticTasks(tx, state, release);
        await this._saveOrigins(
          tx,
          state,
          previous,
          origins,
          release,
          checkedAt,
        );
      }
      signal?.throwIfAborted();
      if (moves.length)
        await this.warehouse.applyAutomaticMovements(tx, state, moves);
      const currentOrigins = release.length
        ? await automationOrigins(tx)
        : origins;
      const effective = automaticPlanningWorkspace(state, currentOrigins);
      const pendingLowering = state.movements.some(
        (movement) =>
          movement.autoPurpose === "accessible_raw" &&
          ["planned", "in_transit"].includes(movement.status),
      );
      const marketplace = await loadMarketplaces(tx);
      const forecast = await this.dependencies.forecast(tx, marketplace, clock);
      if (!forecast.cacheCurrent) {
        await saveAutomationSetting(tx, "runtime", {
          lastCheckedAt: checkedAt,
          message: pendingLowering
            ? "Есть задание спустить сырьё на доступный ярус. План сборки обновляется в фоне."
            : "Обновляем план сборки. Задания появятся автоматически.",
          blockers: ["Дождитесь актуального плана сборки."],
        });
        signal?.throwIfAborted();
        return state.revision !== previousRevision ? "updated" : "skipped";
      }
      const plan = this.dependencies.plan(
        effective,
        marketplace,
        clock,
        forecast,
      );
      const loweringSkus = new Set(
        state.movements
          .filter(
            (movement) =>
              movement.autoPurpose === "accessible_raw" &&
              ["planned", "in_transit"].includes(movement.status),
          )
          .map(
            (movement) =>
              state.pallets.find((pallet) => pallet.id === movement.palletId)
                ?.skuId,
          ),
      );
      // Do not allocate a younger lot while the FIFO pallet is being lowered.
      const assemblyPlan = {
        ...plan,
        rows: plan.rows.filter((row) => !loweringSkus.has(row.skuId)),
      };
      const pressure = this.dependencies.pressure(effective);
      const blocked = ["full", "unavailable"].includes(pressure.level);
      const intents = automaticTaskIntents(
        state,
        assemblyPlan,
        currentOrigins,
        blocked,
      );
      const previous = new Map(
        state.tasks.map((task) => [task.id, structuredClone(task)]),
      );
      signal?.throwIfAborted();
      if (intents.length) {
        await this.warehouse.applyAutomaticTasks(tx, state, intents);
        signal?.throwIfAborted();
        await this._saveOrigins(
          tx,
          state,
          previous,
          currentOrigins,
          intents,
          checkedAt,
        );
      }
      const blockers: string[] = blocked ? [pressure.message] : [];
      const waiting = state.tasks.some(
        (task) => task.status === "queued" && task.employeeId === null,
      );
      if (!blocked && !waiting) {
        if (!plan.rows.length)
          blockers.push("Нет тематик с включённым планированием.");
        if (
          plan.rows.length &&
          plan.rows.every((row) => row.rawAvailableUnits < row.unitsPerBox)
        )
          blockers.push("Для сборки нужно принять и разместить товар.");
        if (plan.rows.some((row) => !row.dataComplete))
          blockers.push(
            "Уточните остатки и дождитесь актуального плана сборки.",
          );
        if (
          plan.rows.length &&
          plan.rows.every((row) => !row.backlogCapacityKnown)
        )
          blockers.push("Подтвердите свободные места хранения.");
        if (
          !blockers.length &&
          plan.rows.some(
            (row) => row.recommendedBoxes > 0 || row.backlogCanCreate,
          )
        )
          blockers.push("Сейчас нет подтверждённого места для новых коробов.");
      }
      await saveAutomationSetting(tx, "runtime", {
        lastCheckedAt: checkedAt,
        message: blocked
          ? pressure.message
          : pendingLowering
            ? "Есть задание спустить сырьё на доступный ярус."
            : waiting
              ? "Свободные задания готовы. Сотрудники могут взять их в работу."
              : (blockers[0] ??
                "Дополнительная сборка сейчас не требуется. План проверяется автоматически."),
        blockers,
      });
      signal?.throwIfAborted();
      return intents.length || state.revision !== previousRevision
        ? "updated"
        : "skipped";
    });
  }
  private async _saveOrigins(
    tx: Queryable,
    state: WorkspaceDto,
    previous: Map<string, WorkspaceDto["tasks"][number]>,
    origins: AutomaticTaskOrigin[],
    intents: AutomaticTaskIntent[],
    checkedAt: string,
  ) {
    const matched = new Set<string>();
    for (const intent of intents) {
      if (intent.kind === "withdraw") {
        const origin = origins.find((item) => item.taskId === intent.taskId);
        const task = previous.get(intent.taskId);
        if (!origin || !task) throw new Error("Automatic task origin missing");
        await saveAutomationOrigin(tx, {
          ...origin,
          updatedAt: checkedAt,
          status: "withdrawn",
          withdrawnAt: checkedAt,
          withdrawnReason: intent.reason,
          withdrawnTask: task,
        });
        continue;
      }
      const task =
        intent.kind === "resize"
          ? state.tasks.find((item) => item.id === intent.taskId)
          : state.tasks.find(
              (item) =>
                !previous.has(item.id) &&
                !matched.has(item.id) &&
                item.skuId === intent.skuId,
            );
      if (!task) throw new Error("Automatic task was not committed");
      matched.add(task.id);
      const old = origins.find((item) => item.taskId === task.id);
      await saveAutomationOrigin(tx, {
        taskId: task.id,
        skuId: task.skuId,
        purpose: intent.purpose,
        proposalHash: intent.proposalHash,
        createdAt: old?.createdAt ?? checkedAt,
        updatedAt: checkedAt,
        boxesTarget: task.boxesTarget,
        status: "queued",
        withdrawnAt: null,
        withdrawnReason: null,
        withdrawnTask: null,
      });
    }
  }
}
