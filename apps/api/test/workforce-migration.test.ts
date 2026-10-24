import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { WarehouseService } from "../src/warehouse.service";
test("schema10 preserves old warehouse auth ledger commands and revision, observes only current working/break from migration instant and never backfills legacy counters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-shifts-migration-")),
    path = join(dir, "db"),
    previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const command = {
        requestId: randomUUID(),
        name: "Исторический склад до смен",
      },
      cached = await w.updateWarehousePlan(command);
    const e = cached.employees.find((e) => e.status === "working")!;
    await w.authTransaction(async (tx) => {
      await tx.query("UPDATE employees SET payload=$2 WHERE id=$1", [
        e.id,
        JSON.stringify({ ...e, boxesToday: 999, unitsToday: 19980 }),
      ]);
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES('legacy-shift-manager',$1,'legacy-manager','fixture-only-hash','manager',FALSE)",
        [e.id],
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES('legacy-shift-session','legacy-shift-manager','fixture-only-token-hash','fixture-only-csrf',NOW()+INTERVAL '1 hour')",
      );
    });
    const original = await w.snapshot(),
      ledger = await w.getStockLedger({});
    await w.onModuleDestroy();
    w = undefined;
    const db = new PGlite(path);
    await db.waitReady;
    await db.exec(
      "DROP TABLE work_events;DROP TABLE shift_intervals;DROP TABLE employee_shifts;DELETE FROM metadata WHERE key='work_tracking_since';UPDATE metadata SET value='9' WHERE key='schema_version'",
    );
    const beforeCommands = (
        await db.query("SELECT * FROM commands ORDER BY request_id")
      ).rows,
      beforeLedger = (await db.query("SELECT * FROM stock_ledger ORDER BY id"))
        .rows,
      beforeAccounts = (
        await db.query("SELECT * FROM auth_accounts ORDER BY id")
      ).rows,
      beforeSessions = (
        await db.query("SELECT * FROM auth_sessions ORDER BY id")
      ).rows;
    await db.close();
    const migrationStart = new Date().toISOString();
    w = new WarehouseService();
    const after = await w.snapshot();
    assert.deepEqual(after, original);
    assert.deepEqual(await w.getStockLedger({}), ledger);
    assert.deepEqual(await w.updateWarehousePlan(command), cached);
    const report = await w.getPerformance({}),
      history = await w.getShiftHistory({ pageSize: 100 });
    assert.equal(report.trackingSince >= migrationStart, true);
    assert.equal(
      history.total,
      original.employees.filter((e) => e.status !== "off").length,
    );
    for (const shift of history.items) {
      assert.equal(shift.origin, "observed_from_migration");
      assert.equal(shift.startedAt, report.trackingSince);
      assert.equal(shift.startedByEmployeeId, null);
      assert.equal(shift.intervals[0].actorEmployeeId, null);
      assert.equal(
        shift.intervals[0].status,
        original.employees.find((e) => e.id === shift.employeeId)!.status,
      );
    }
    for (const row of report.employees) {
      assert.equal(row.metrics.boxesPacked, 0);
      assert.equal(row.metrics.unitsPacked, 0);
      if (row.status === "off") assert.equal(row.currentShift, null);
    }
    assert.equal((await w.getWorkHistory({})).total, 0);
    const persisted = await w.authTransaction(async (tx) => ({
      commands: (await tx.query("SELECT * FROM commands ORDER BY request_id"))
        .rows,
      ledger: (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
      accounts: (await tx.query("SELECT * FROM auth_accounts ORDER BY id"))
        .rows,
      sessions: (await tx.query("SELECT * FROM auth_sessions ORDER BY id"))
        .rows,
    }));
    assert.deepEqual(persisted, {
      commands: beforeCommands,
      ledger: beforeLedger,
      accounts: beforeAccounts,
      sessions: beforeSessions,
    });
    const shiftIds = history.items.map((s) => s.id).sort();
    await w.onModuleDestroy();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), original);
    assert.equal(
      (await w.getPerformance({})).trackingSince,
      report.trackingSince,
    );
    assert.deepEqual(
      (await w.getShiftHistory({ pageSize: 100 })).items
        .map((s) => s.id)
        .sort(),
      shiftIds,
    );
    assert.equal((await w.getWorkHistory({})).total, 0);
  } finally {
    await w?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
