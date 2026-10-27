import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { Queryable } from "./database";
import * as D from "./dto";
import { requestAuth } from "./auth-context";
const iso = (v: string | Date) => new Date(v).toISOString();
export async function initializeWorkforce(
  tx: Queryable,
  state: D.WorkspaceDto,
) {
  await tx.query(
    `CREATE TABLE IF NOT EXISTS employee_shifts(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),employee_name TEXT NOT NULL,started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,origin TEXT NOT NULL CHECK(origin IN ('explicit','observed_from_migration')),started_by_employee_id TEXT,started_by_name TEXT,ended_by_employee_id TEXT,ended_by_name TEXT,CHECK(ended_at IS NULL OR ended_at>=started_at))`,
  );
  await tx.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS employee_shifts_open_idx ON employee_shifts(employee_id) WHERE ended_at IS NULL`,
  );
  await tx.query(
    `CREATE TABLE IF NOT EXISTS shift_intervals(id TEXT PRIMARY KEY,shift_id TEXT NOT NULL REFERENCES employee_shifts(id),status TEXT NOT NULL CHECK(status IN ('working','break')),started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,actor_employee_id TEXT,actor_name TEXT,CHECK(ended_at IS NULL OR ended_at>=started_at))`,
  );
  await tx.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS shift_intervals_open_idx ON shift_intervals(shift_id) WHERE ended_at IS NULL`,
  );
  await tx.query(
    `CREATE TABLE IF NOT EXISTS work_events(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),employee_name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('box_packed','receipt_pallet_placed','putaway_box_placed','movement_pallet_placed')),occurred_at TIMESTAMPTZ NOT NULL,request_id TEXT,shift_id TEXT REFERENCES employee_shifts(id),reference_id TEXT NOT NULL,reference_code TEXT NOT NULL,source_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity=1),units INTEGER NOT NULL CHECK(units>=0),UNIQUE(kind,source_id))`,
  );
  await tx.query(
    `CREATE INDEX IF NOT EXISTS work_events_employee_time_idx ON work_events(employee_id,occurred_at DESC,id DESC)`,
  );
  await tx.query(
    `CREATE INDEX IF NOT EXISTS employee_shifts_employee_time_idx ON employee_shifts(employee_id,started_at DESC,id DESC)`,
  );
  await tx.query(
    `CREATE OR REPLACE FUNCTION reject_work_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'work_events is immutable'; END; $$`,
  );
  await tx.query(`DROP TRIGGER IF EXISTS work_events_immutable ON work_events`);
  await tx.query(
    `CREATE TRIGGER work_events_immutable BEFORE UPDATE OR DELETE ON work_events FOR EACH ROW EXECUTE FUNCTION reject_work_event_mutation()`,
  );
  const tracking = await tx.query(
    "SELECT value FROM metadata WHERE key='work_tracking_since'",
  );
  if (!tracking.rows.length) {
    const at = new Date().toISOString();
    await tx.query(
      "INSERT INTO metadata(key,value) VALUES('work_tracking_since',$1)",
      [at],
    );
    for (const e of state.employees)
      if (["working", "break"].includes(e.status))
        await openShift(
          tx,
          e,
          e.status,
          at,
          "observed_from_migration",
          null,
          null,
        );
  }
}
async function openShift(
  tx: Queryable,
  employee: D.EmployeeDto,
  status: string,
  at: string,
  origin: string,
  actorId: string | null,
  actorName: string | null,
) {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO employee_shifts(id,employee_id,employee_name,started_at,origin,started_by_employee_id,started_by_name) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, employee.id, employee.name, at, origin, actorId, actorName],
  );
  await tx.query(
    "INSERT INTO shift_intervals(id,shift_id,status,started_at,actor_employee_id,actor_name) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), id, status, at, actorId, actorName],
  );
}
export function workforceBefore(state: D.WorkspaceDto) {
  return {
    statuses: new Map(state.employees.map((e) => [e.id, e.status])),
    boxes: new Set(state.boxes.map((b) => b.id)),
    receiptPlaced: new Map(
      state.receipts.flatMap((r) =>
        r.pallets.map((p) => [p.palletId, p.placedAt] as const),
      ),
    ),
    putaways: new Map(state.putawayTasks.map((t) => [t.id, t.status])),
    movements: new Map(state.movements.map((m) => [m.id, m.status])),
    boxOwners: new Map(state.tasks.map((t) => [t.openBoxCode, t.employeeId])),
  };
}
type Before = ReturnType<typeof workforceBefore>;
export async function recordWorkforce(
  tx: Queryable,
  before: Before,
  state: D.WorkspaceDto,
  body: D.CommandDto,
) {
  const context = requestAuth.getStore(),
    at = new Date().toISOString();
  for (const e of state.employees) {
    const previous = before.statuses.get(e.id);
    if (previous === undefined || previous === e.status) continue;
    const actorId = context?.http ? (context.employeeId ?? null) : e.id,
      actorName = state.employees.find((x) => x.id === actorId)?.name ?? null;
    if (previous === "off" && e.status === "working")
      await openShift(tx, e, "working", at, "explicit", actorId, actorName);
    else {
      const shift = (
        await tx.query<{ id: string }>(
          "SELECT id FROM employee_shifts WHERE employee_id=$1 AND ended_at IS NULL",
          [e.id],
        )
      ).rows[0];
      if (!shift)
        throw new Error("У активного сотрудника отсутствует открытая смена");
      await tx.query(
        "UPDATE shift_intervals SET ended_at=$2 WHERE shift_id=$1 AND ended_at IS NULL",
        [shift.id, at],
      );
      if (e.status === "off")
        await tx.query(
          "UPDATE employee_shifts SET ended_at=$2,ended_by_employee_id=$3,ended_by_name=$4 WHERE id=$1",
          [shift.id, at, actorId, actorName],
        );
      else
        await tx.query(
          "INSERT INTO shift_intervals(id,shift_id,status,started_at,actor_employee_id,actor_name) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), shift.id, e.status, at, actorId, actorName],
        );
    }
  }
  const write = async (
    kind: string,
    sourceId: string,
    referenceId: string,
    referenceCode: string,
    occurredAt: string,
    units: number,
    assigned: string | null,
  ) => {
    const explicit =
      "employeeId" in body && typeof body.employeeId === "string"
        ? body.employeeId
        : null;
    const employeeId = context?.http
      ? context.employeeId
      : (explicit ?? assigned);
    const employee = state.employees.find((e) => e.id === employeeId);
    if (!employee)
      throw new Error("Неизвестный исполнитель завершённой операции");
    const shift = (
      await tx.query<{ id: string }>(
        "SELECT id FROM employee_shifts WHERE employee_id=$1 AND started_at<=$2 AND (ended_at IS NULL OR ended_at>$2) ORDER BY started_at DESC,id DESC LIMIT 1",
        [employee.id, occurredAt],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO work_events(id,employee_id,employee_name,kind,occurred_at,request_id,shift_id,reference_id,reference_code,source_id,quantity,units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)",
      [
        randomUUID(),
        employee.id,
        employee.name,
        kind,
        occurredAt,
        body.requestId,
        shift?.id ?? null,
        referenceId,
        referenceCode,
        sourceId,
        units,
      ],
    );
  };
  for (const box of state.boxes)
    if (!before.boxes.has(box.id) && !box.openingStocktakeId) {
      if (!box.packedAt) throw new Error("Неизвестная дата завершения сборки");
      await write(
        "box_packed",
        box.id,
        box.id,
        box.code,
        box.packedAt,
        box.units,
        before.boxOwners.get(box.code) ?? null,
      );
    }
  for (const receipt of state.receipts)
    for (const row of receipt.pallets)
      if (row.placedAt && !before.receiptPlaced.get(row.palletId)) {
        const pallet = state.pallets.find((p) => p.id === row.palletId)!;
        await write(
          "receipt_pallet_placed",
          row.palletId,
          pallet.id,
          pallet.code,
          row.placedAt,
          0,
          row.placedByEmployeeId,
        );
      }
  for (const task of state.putawayTasks)
    if (
      task.status === "completed" &&
      before.putaways.get(task.id) !== "completed"
    ) {
      const box = state.boxes.find((b) => b.id === task.boxId)!;
      await write(
        "putaway_box_placed",
        task.id,
        box.id,
        box.code,
        task.completedAt!,
        0,
        task.employeeId,
      );
    }
  for (const movement of state.movements)
    if (
      movement.status === "completed" &&
      before.movements.get(movement.id) !== "completed"
    ) {
      const pallet = state.pallets.find((p) => p.id === movement.palletId)!;
      await write(
        "movement_pallet_placed",
        movement.id,
        pallet.id,
        pallet.code,
        movement.completedAt!,
        0,
        movement.employeeId,
      );
    }
}
export interface ReportPeriod {
  from: string;
  to: string;
  start: string;
  end: string;
  now: string;
}
export async function reportPeriod(
  tx: Queryable,
  q: D.PerformanceQueryDto,
): Promise<ReportPeriod> {
  const now = new Date().toISOString(),
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
  const part = (kind: string) => parts.find((p) => p.type === kind)!.value,
    today = `${part("year")}-${part("month")}-${part("day")}`;
  const from = q.from ?? q.to ?? today,
    to = q.to ?? q.from ?? today;
  for (const d of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
      d.startsWith("0000") ||
      !Number.isFinite(Date.parse(`${d}T00:00:00Z`)) ||
      new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d
    )
      throw new BadRequestException(
        "Укажите корректные календарные даты YYYY-MM-DD",
      );
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000 +
    1;
  if (days < 1 || days > 366)
    throw new BadRequestException(
      "Период должен быть от 1 до 366 календарных дней",
    );
  const bounds = await tx.query<{
    start_at: string | Date;
    end_at: string | Date;
  }>(
    "SELECT ($1::date::timestamp AT TIME ZONE 'Europe/Moscow') AS start_at,(($2::date+1)::timestamp AT TIME ZONE 'Europe/Moscow') AS end_at",
    [from, to],
  );
  return {
    from,
    to,
    start: iso(bounds.rows[0].start_at),
    end: iso(bounds.rows[0].end_at),
    now,
  };
}
const trackingSince = async (tx: Queryable) =>
  (
    await tx.query<{ value: string }>(
      "SELECT value FROM metadata WHERE key='work_tracking_since'",
    )
  ).rows[0].value;
const durationSql = `GREATEST(0,EXTRACT(EPOCH FROM LEAST(COALESCE(i.ended_at,$4::timestamptz),$3::timestamptz,$4::timestamptz)-GREATEST(i.started_at,$2::timestamptz)))`;
const zeroMetrics = (): D.PerformanceMetricsDto => ({
  boxesPacked: 0,
  unitsPacked: 0,
  receiptPalletsPlaced: 0,
  putawayBoxesPlaced: 0,
  movementPalletsPlaced: 0,
  workingSeconds: 0,
  breakSeconds: 0,
});
export async function performanceReport(
  tx: Queryable,
  state: D.WorkspaceDto,
  employees: D.EmployeeDto[],
  period: ReportPeriod,
): Promise<D.PerformanceReportDto> {
  const ids = employees.map((e) => e.id);
  const durations = await tx.query<{
    employee_id: string;
    working: string;
    break: string;
  }>(
    `SELECT s.employee_id,COALESCE(SUM(CASE WHEN i.status='working' THEN ${durationSql} ELSE 0 END),0) AS working,COALESCE(SUM(CASE WHEN i.status='break' THEN ${durationSql} ELSE 0 END),0) AS break FROM employee_shifts s JOIN shift_intervals i ON i.shift_id=s.id WHERE s.employee_id=ANY($1::text[]) AND i.started_at<$3 AND COALESCE(i.ended_at,$4)>$2 GROUP BY s.employee_id`,
    [ids, period.start, period.end, period.now],
  );
  const counts = await tx.query<{
    employee_id: string;
    kind: string;
    quantity: string;
    units: string;
  }>(
    "SELECT employee_id,kind,SUM(quantity) AS quantity,SUM(units) AS units FROM work_events WHERE employee_id=ANY($1::text[]) AND occurred_at>=$2 AND occurred_at<$3 AND occurred_at<=$4 GROUP BY employee_id,kind",
    [ids, period.start, period.end, period.now],
  );
  const rows: D.EmployeePerformanceDto[] = [];
  for (const e of employees) {
    const metrics = zeroMetrics(),
      time = durations.rows.find((r) => r.employee_id === e.id);
    if (time) {
      metrics.workingSeconds = Number(time.working);
      metrics.breakSeconds = Number(time.break);
    }
    for (const c of counts.rows.filter((c) => c.employee_id === e.id)) {
      if (c.kind === "box_packed") {
        metrics.boxesPacked = Number(c.quantity);
        metrics.unitsPacked = Number(c.units);
      } else if (c.kind === "receipt_pallet_placed")
        metrics.receiptPalletsPlaced = Number(c.quantity);
      else if (c.kind === "putaway_box_placed")
        metrics.putawayBoxesPlaced = Number(c.quantity);
      else if (c.kind === "movement_pallet_placed")
        metrics.movementPalletsPlaced = Number(c.quantity);
    }
    const active = await tx.query<any>(
      `SELECT s.id,s.started_at,s.origin,i.status,i.started_at AS period_started_at FROM employee_shifts s JOIN shift_intervals i ON i.shift_id=s.id AND i.ended_at IS NULL WHERE s.employee_id=$1 AND s.ended_at IS NULL`,
      [e.id],
    );
    let currentShift: D.CurrentShiftDto | null = null;
    if (active.rows[0]) {
      const a = active.rows[0];
      const total = await tx.query<any>(
        `SELECT i.status,SUM(GREATEST(0,EXTRACT(EPOCH FROM LEAST(COALESCE(i.ended_at,$2::timestamptz),$2::timestamptz)-i.started_at))) AS seconds FROM shift_intervals i WHERE i.shift_id=$1 GROUP BY i.status`,
        [a.id, period.now],
      );
      currentShift = {
        id: a.id,
        startedAt: iso(a.started_at),
        origin: a.origin,
        status: a.status,
        periodStartedAt: iso(a.period_started_at),
        workingSeconds: Number(
          total.rows.find((r: any) => r.status === "working")?.seconds ?? 0,
        ),
        breakSeconds: Number(
          total.rows.find((r: any) => r.status === "break")?.seconds ?? 0,
        ),
      };
    }
    const currentJobs: D.WorkJobDto[] = [];
    for (const t of state.tasks.filter(
      (t) => t.employeeId === e.id && ["active", "paused"].includes(t.status),
    ))
      currentJobs.push({
        id: t.id,
        code: t.code,
        kind: "assembly",
        status: t.status,
        description: state.skus.find((s) => s.id === t.skuId)?.name ?? t.code,
      });
    for (const t of state.putawayTasks.filter(
      (t) =>
        t.employeeId === e.id && ["claimed", "in_transit"].includes(t.status),
    ))
      currentJobs.push({
        id: t.id,
        code: t.code,
        kind: "putaway",
        status: t.status,
        description: state.boxes.find((b) => b.id === t.boxId)?.code ?? t.code,
      });
    for (const m of state.movements.filter(
      (m) =>
        m.employeeId === e.id && ["planned", "in_transit"].includes(m.status),
    ))
      currentJobs.push({
        id: m.id,
        code: m.code,
        kind: "movement",
        status: m.status,
        description:
          state.pallets.find((p) => p.id === m.palletId)?.code ?? m.code,
      });
    const stocktakes = await tx.query<{ payload: D.StocktakeSummaryDto }>(
      "SELECT payload FROM stocktakes WHERE payload->>'status'='counting' AND payload->>'employeeId'=$1",
      [e.id],
    );
    for (const { payload: d } of stocktakes.rows)
      currentJobs.push({
        id: d.id,
        code: d.code,
        kind: "stocktake",
        status: d.status,
        description: `Подсчёт ${d.locationsTotal} ячеек`,
      });
    rows.push({
      employeeId: e.id,
      employeeName: e.name,
      status: e.status,
      currentShift,
      currentJobs,
      metrics,
    });
  }
  return {
    trackingSince: await trackingSince(tx),
    from: period.from,
    to: period.to,
    timezone: "Europe/Moscow",
    generatedAt: period.now,
    employees: rows,
  };
}
export async function workHistory(
  tx: Queryable,
  ids: string[],
  q: D.WorkforceHistoryQueryDto,
  p: ReportPeriod,
): Promise<D.WorkHistoryPageDto> {
  const page = q.page ?? 1,
    pageSize = q.pageSize ?? 25,
    params = [ids, p.start, p.end, p.now];
  const filter =
    "employee_id=ANY($1::text[]) AND occurred_at>=$2 AND occurred_at<$3 AND occurred_at<=$4";
  const count = await tx.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM work_events WHERE ${filter}`,
    params,
  );
  const events = await tx.query<any>(
    `SELECT * FROM work_events WHERE ${filter} ORDER BY occurred_at DESC,id DESC LIMIT $5 OFFSET $6`,
    [...params, pageSize, (BigInt(page - 1) * BigInt(pageSize)).toString()],
  );
  return {
    trackingSince: await trackingSince(tx),
    page,
    pageSize,
    total: Number(count.rows[0].count),
    items: events.rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      kind: r.kind,
      occurredAt: iso(r.occurred_at),
      requestId: r.request_id,
      shiftId: r.shift_id,
      referenceId: r.reference_id,
      referenceCode: r.reference_code,
      quantity: r.quantity,
      units: r.units,
    })),
  };
}
export async function shiftHistory(
  tx: Queryable,
  ids: string[],
  q: D.WorkforceHistoryQueryDto,
  p: ReportPeriod,
): Promise<D.ShiftHistoryPageDto> {
  const page = q.page ?? 1,
    pageSize = q.pageSize ?? 25,
    params = [ids, p.start, p.end, p.now];
  const filter =
    "employee_id=ANY($1::text[]) AND started_at<$3 AND started_at<=$4 AND COALESCE(ended_at,$4)>$2";
  const count = await tx.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM employee_shifts WHERE ${filter}`,
    params,
  );
  const shifts = await tx.query<any>(
    `SELECT * FROM employee_shifts WHERE ${filter} ORDER BY started_at DESC,id DESC LIMIT $5 OFFSET $6`,
    [...params, pageSize, (BigInt(page - 1) * BigInt(pageSize)).toString()],
  );
  const intervals = await tx.query<any>(
    `SELECT i.*,${durationSql} AS seconds FROM shift_intervals i WHERE i.shift_id=ANY($1::text[]) AND i.started_at<$3 AND i.started_at<=$4 AND COALESCE(i.ended_at,$4)>$2 ORDER BY i.started_at,i.id`,
    [shifts.rows.map((s) => s.id), p.start, p.end, p.now],
  );
  const items: D.ShiftHistoryDto[] = shifts.rows.map((s) => {
    const rows = intervals.rows.filter((i) => i.shift_id === s.id),
      sum = (status: string) =>
        rows
          .filter((i) => i.status === status)
          .reduce((sum, i) => sum + Number(i.seconds), 0);
    return {
      id: s.id,
      employeeId: s.employee_id,
      employeeName: s.employee_name,
      startedAt: iso(s.started_at),
      endedAt: s.ended_at ? iso(s.ended_at) : null,
      origin: s.origin,
      startedByEmployeeId: s.started_by_employee_id,
      startedByName: s.started_by_name,
      endedByEmployeeId: s.ended_by_employee_id,
      endedByName: s.ended_by_name,
      workingSeconds: sum("working"),
      breakSeconds: sum("break"),
      intervals: rows.map((i) => ({
        id: i.id,
        status: i.status,
        startedAt: iso(i.started_at),
        endedAt: i.ended_at ? iso(i.ended_at) : null,
        actorEmployeeId: i.actor_employee_id,
        actorName: i.actor_name,
        durationSeconds: Number(i.seconds),
      })),
    };
  });
  return {
    trackingSince: await trackingSince(tx),
    page,
    pageSize,
    total: Number(count.rows[0].count),
    items,
  };
}
