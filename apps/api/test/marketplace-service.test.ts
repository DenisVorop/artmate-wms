import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
import { MarketplaceService } from "../src/marketplaces/marketplace.service";
import { MarketplaceSecrets } from "../src/marketplaces/secrets";
import { requestAuth, RequestAuthContext } from "../src/auth-context";
import { MarketplaceSnapshot } from "../src/marketplaces/providers/types";
const req = () => ({ requestId: randomUUID() });
const context = (role: string): RequestAuthContext => ({
  http: true,
  tokenHash: `marketplace-${role}`,
  csrfToken: `csrf-${role}`,
  origin: "http://127.0.0.1:3080",
});
const as = <T>(role: string, fn: () => T) => requestAuth.run(context(role), fn);
test("manager integrations encrypt keys, preserve stock/history on read and sync, replay safely, retain last good after partial/failure and reject revoked auth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-marketplace-service-")),
    old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const baseline = await w.snapshot();
    await w.authTransaction(async (tx) => {
      for (const role of ["manager", "employee"]) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$1,FALSE)",
          [role, role === "manager" ? "employee-3" : "employee-1"],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [role, `marketplace-${role}`, `csrf-${role}`],
        );
      }
    });
    let mode: "complete" | "partial" | "fail" = "complete",
      calls = 0;
    const service = MarketplaceService.forTesting(
      w,
      new MarketplaceSecrets({ path: join(dir, "key") }),
      async (provider, credentials, period) => {
        calls++;
        assert.equal(credentials.apiKey, "private-api-key-123");
        assert.equal(
          (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1,
          28,
          "sync uses configured history without an implicit 56-day overfetch",
        );
        if (mode === "fail") throw new Error("private-api-key-123 raw error");
        const s: MarketplaceSnapshot = {
          provider,
          ...period,
          asOf: new Date().toISOString(),
          products: [
            { externalId: "p1", name: "Котики", barcodes: ["4601234000011"] },
          ],
          stocks: [
            {
              externalId: "p1",
              warehouseId: "fbo",
              warehouseName: "FBO",
              availableUnits: 0,
              reservedUnits: 0,
              inboundUnits: null,
            },
          ],
          demand: [
            {
              externalId: "p1",
              date: period.from,
              orderedUnits: 0,
              cancelledUnits: 0,
              returnedUnits: 0,
              soldUnits: null,
            },
            {
              externalId: "p1",
              date: period.to,
              orderedUnits: 560,
              cancelledUnits: 0,
              returnedUnits: 0,
              soldUnits: null,
            },
          ],
          coverage: {
            catalog: true,
            stocks: true,
            demand: mode !== "partial",
            inbound: false,
          },
          supplies: [
            {
              id: "supply:123",
              statusCode: "6",
              statusLabel: "Отгружена на воротах",
              expectedAt: null,
              receivedAt: null,
              updatedAt: null,
              calculation: "document",
              warnings: [],
              items: [
                {
                  externalId: "p1",
                  name: "Котики",
                  plannedUnits: 20,
                  acceptedUnits: 0,
                  readyUnits: 0,
                  pendingUnits: 20,
                },
              ],
            },
          ],
          warnings: [],
        };
        return s;
      },
    );
    await assert.rejects(service.getMarketplaces(), /Войдите/);
    await assert.rejects(
      as("employee", () => service.getMarketplaces()),
      /руководителя/,
    );
    const connect = {
      ...req(),
      provider: "wildberries" as const,
      apiKey: "private-api-key-123",
    };
    const connected = await as("manager", () =>
      service.connectMarketplace(connect),
    );
    assert.equal(connected.connections[0].configured, true);
    assert.ok(!JSON.stringify(connected).includes(connect.apiKey));
    assert.deepEqual(
      await as("manager", () => service.connectMarketplace(connect)),
      connected,
    );
    await assert.rejects(
      as("manager", () =>
        service.connectMarketplace({ ...connect, apiKey: "changed" }),
      ),
      /requestId/,
    );
    await assert.rejects(
      w.createTask({
        requestId: connect.requestId,
        skuId: "sku-cats",
        boxesTarget: 1,
      }),
      /requestId/,
    );

    await w.authTransaction(async (tx) => {
      const raw = await tx.query("SELECT payload FROM marketplace_connections");
      assert.ok(!JSON.stringify(raw.rows).includes(connect.apiKey));
      const commands = await tx.query(
        "SELECT fingerprint,response FROM commands WHERE request_id=$1",
        [connect.requestId],
      );
      assert.ok(!JSON.stringify(commands.rows).includes(connect.apiKey));
    });
    const sync = { ...req(), provider: "wildberries" as const };
    const loaded = await as("manager", () => service.syncMarketplace(sync));
    assert.equal(calls, 1);
    assert.equal(loaded.products[0].suggestedSkuId, "sku-cats");
    assert.equal(loaded.products[0].skuId, null);
    assert.equal(loaded.connections[0].syncStatus, "success");
    assert.equal(loaded.supplies[0].items[0].skuId, null);
    assert.equal(loaded.supplies[0].provider, "wildberries");
    await w.authTransaction(async (tx) => {
      const persisted = await tx.query<{ payload: MarketplaceSnapshot }>(
        "SELECT payload FROM marketplace_snapshots",
      );
      assert.equal(
        persisted.rows[0].payload.supplies![0].items[0].pendingUnits,
        20,
      );
      assert.ok(!JSON.stringify(persisted.rows).includes(connect.apiKey));
    });
    await as("manager", () => service.syncMarketplace(sync));
    assert.equal(calls, 1);
    await as("manager", () =>
      service.mapMarketplaceProduct({
        ...req(),
        provider: "wildberries",
        externalId: "p1",
        skuId: "sku-cats",
        unitsPerItem: 1,
      }),
    );
    const reloaded = await as("manager", () => service.getMarketplaces());
    assert.equal(reloaded.supplies[0].items[0].skuId, "sku-cats");
    const beforeRefresh = await as("manager", () =>
      service.setMarketplaceTransit({
        ...req(),
        skuId: "sku-cats",
        inTransitUnits: 0,
      }),
    );
    mode = "partial";
    const partial = await as("manager", () =>
      service.syncMarketplace({ ...req(), provider: "wildberries" }),
    );
    assert.equal(partial.connections[0].syncStatus, "partial");
    assert.equal(partial.products.length, 1);
    assert.equal(partial.plan.rows[0].canCreate, false);
    mode = "fail";
    const failed = await as("manager", () =>
      service.syncMarketplace({ ...req(), provider: "wildberries" }),
    );
    assert.equal(failed.connections[0].syncStatus, "failed");
    assert.equal(failed.products.length, 1);
    const savedRow = beforeRefresh.previousPlan!.rows.find(
      (r) => r.skuId === "sku-cats",
    )!;
    for (const result of [partial, failed]) {
      assert.ok(
        result.previousPlan,
        "a failed refresh keeps the persisted display projection",
      );
      assert.equal(
        result.previousPlan.generatedAt,
        beforeRefresh.previousPlan!.generatedAt,
      );
      const previous = result.previousPlan.rows.find(
        (r) => r.skuId === "sku-cats",
      )!;
      assert.equal(previous.recommendedBoxes, savedRow.recommendedBoxes);
      assert.equal(previous.canCreate, false);
      assert.equal(previous.backlogCanCreate, false);
    }
    await assert.rejects(
      as("manager", () =>
        service.createMarketplaceTask({
          ...req(),
          skuId: "sku-cats",
          proposalHash: savedRow.proposalHash,
        }),
      ),
      /устарел|создать|провер/i,
    );

    assert.ok(!JSON.stringify(failed).includes(connect.apiKey));
    assert.deepEqual(await w.snapshot(), baseline);
    mode = "complete";
    const refreshed = await as("manager", () =>
      service.syncMarketplace({ ...req(), provider: "wildberries" }),
    );
    assert.equal(
      refreshed.plan.rows.find((r) => r.skuId === "sku-cats")!.inTransitUnits,
      null,
    );
    const confirmed = await as("manager", () =>
      service.setMarketplaceTransit({
        ...req(),
        skuId: "sku-cats",
        inTransitUnits: 0,
      }),
    );
    const proposal = confirmed.plan.rows.find((r) => r.skuId === "sku-cats")!;
    assert.equal(proposal.dataComplete, true);
    assert.equal(
      proposal.canCreate,
      true,
      JSON.stringify({
        blockers: proposal.blockers,
        average: proposal.averageDailyUnits,
        recommended: proposal.recommendedBoxes,
        raw: proposal.rawAvailableUnits,
      }),
    );
    assert.ok(proposal.recommendedBoxes > 0);
    const body = {
      ...req(),
      skuId: "sku-cats",
      proposalHash: proposal.proposalHash,
    };
    const duplicate = { ...body, ...req() };
    const originalCommit = w.commitPlanningTask.bind(w);
    const beforeRollback = await w.snapshot();
    w.commitPlanningTask = async (...args) => {
      await originalCommit(...args);
      throw new Error("test rollback after warehouse commit");
    };
    await assert.rejects(
      as("manager", () => service.createMarketplaceTask(body)),
      /test rollback/,
    );
    w.commitPlanningTask = originalCommit;
    assert.deepEqual(await w.snapshot(), beforeRollback);
    await w.authTransaction(async (tx) => {
      assert.equal(
        (await tx.query("SELECT id FROM marketplace_task_origins")).rows.length,
        0,
      );
      assert.equal(
        (
          await tx.query(
            "SELECT request_id FROM commands WHERE request_id=$1",
            [body.requestId],
          )
        ).rows.length,
        0,
      );
    });
    const outcomes = await Promise.allSettled([
      as("manager", () => service.createMarketplaceTask(body)),
      as("manager", () => service.createMarketplaceTask(duplicate)),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
    const first = outcomes[0];
    assert.equal(first.status, "fulfilled");
    if (first.status !== "fulfilled") throw new Error("First command must win");
    let created = await w.snapshot();
    assert.equal(created.tasks.length, baseline.tasks.length + 1);
    assert.equal(created.tasks.at(-1)!.employeeId, null);
    assert.equal(created.tasks.at(-1)!.status, "queued");
    assert.equal(created.tasks.at(-1)!.boxesTarget, proposal.recommendedBoxes);
    assert.deepEqual(created.boxes, baseline.boxes);
    assert.deepEqual(created.pallets, baseline.pallets);
    assert.deepEqual(created.balance, baseline.balance);
    assert.deepEqual(
      await as("manager", () => service.createMarketplaceTask(body)),
      first.value,
    );
    await w.authTransaction(async (tx) => {
      const origins = await tx.query<{
        payload: { taskId: string; sourceType: string; proposalHash: string };
      }>("SELECT payload FROM marketplace_task_origins");
      assert.equal(origins.rows.length, 1);
      assert.equal(origins.rows[0].payload.taskId, first.value.taskId);
      assert.equal(origins.rows[0].payload.sourceType, "forecast");
      assert.equal(origins.rows[0].payload.proposalHash, proposal.proposalHash);
      assert.ok(!JSON.stringify(origins.rows).includes(connect.apiKey));
    });
    await assert.rejects(
      as("manager", () =>
        service.createMarketplaceTask({
          ...req(),
          skuId: "sku-cats",
          proposalHash: proposal.proposalHash,
        }),
      ),
      /устарел/,
    );
    // Optional work is an explicit one-box command with independent purpose,
    // fresh capacity checks and the same transactional replay protection.
    const covered = await as("manager", () =>
      service.setMarketplaceTransit({
        ...req(),
        skuId: "sku-cats",
        inTransitUnits: 100000,
      }),
    );
    const optional = covered.plan.rows.find((row) => row.skuId === "sku-cats")!;
    assert.equal(optional.recommendedBoxes, 0);
    assert.equal(optional.backlogCanCreate, true, optional.backlogReason);
    const optionalBody = {
      ...req(),
      skuId: "sku-cats",
      proposalHash: optional.proposalHash,
      purpose: "backlog" as const,
    };
    const optionalResult = await as("manager", () =>
      service.createMarketplaceTask(optionalBody),
    );
    assert.equal(
      (await w.snapshot()).tasks.find(
        (task) => task.id === optionalResult.taskId,
      )!.boxesTarget,
      1,
    );
    assert.deepEqual(
      await as("manager", () => service.createMarketplaceTask(optionalBody)),
      optionalResult,
    );
    await assert.rejects(
      as("manager", () =>
        service.createMarketplaceTask({ ...optionalBody, purpose: "urgent" }),
      ),
      /requestId/,
    );
    await assert.rejects(
      as("manager", () =>
        service.createMarketplaceTask({ ...optionalBody, ...req() }),
      ),
      /устарел/,
    );
    const fresh = optionalResult.overview.plan.rows.find(
      (row) => row.skuId === "sku-cats",
    )!;
    await as("manager", () =>
      service.confirmPlanningStock({
        ...req(),
        entries: [
          {
            skuId: "sku-cats",
            enabled: true,
            units: 1000,
            accuracy: "approximate",
            note: "Test count",
          },
        ],
      }),
    );
    await assert.rejects(
      as("manager", () =>
        service.createMarketplaceTask({
          ...req(),
          skuId: "sku-cats",
          proposalHash: fresh.proposalHash,
          purpose: "backlog",
        }),
      ),
      /устарел/,
    );
    const blocked = (
      await as("manager", () => service.getMarketplaces())
    ).plan.rows.find((row) => row.skuId === "sku-cats")!;
    assert.equal(blocked.backlogCanCreate, false);
    await assert.rejects(
      as("manager", () =>
        service.createMarketplaceTask({
          ...req(),
          skuId: "sku-cats",
          proposalHash: blocked.proposalHash,
          purpose: "backlog",
        }),
      ),
      /свободные места|размечен/i,
    );
    created = await w.snapshot();
    // An unrelated warehouse read completes while the provider request is awaiting its response.
    let started!: () => void, release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      }),
      releasePromise = new Promise<void>((resolve) => {
        release = resolve;
      });
    const slow = MarketplaceService.forTesting(
      w,
      new MarketplaceSecrets({ path: join(dir, "key") }),
      async (provider, credentials, period) => {
        started();
        await releasePromise;
        return {
          provider,
          ...period,
          asOf: new Date().toISOString(),
          products: [],
          stocks: [],
          demand: [],
          coverage: {
            catalog: true,
            stocks: true,
            demand: true,
            inbound: false,
          },
          warnings: [],
        };
      },
    );
    const pending = as("manager", () =>
      slow.syncMarketplace({ ...req(), provider: "wildberries" }),
    ).then(
      () => null,
      (error) => error,
    );
    await startedPromise;
    assert.equal((await w.snapshot()).revision, created.revision);
    await as("manager", () =>
      service.toggleMarketplace({
        ...req(),
        provider: "wildberries",
        enabled: false,
      }),
    );
    release();
    assert.match(String(await pending), /изменились/);
    await w.authTransaction(async (tx) => {
      await tx.query("DELETE FROM auth_sessions WHERE account_id='manager'");
    });
    await assert.rejects(
      as("manager", () => service.createMarketplaceTask(body)),
      /Сессия/,
    );

    await assert.rejects(
      as("manager", () => service.connectMarketplace(connect)),
      /Сессия/,
    );
  } finally {
    await w?.onModuleDestroy();
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
