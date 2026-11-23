import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Queryable } from "./database";
import * as D from "./dto";
import { requestAuth } from "./auth-context";

export async function initializeTaskHistory(tx: Queryable) {
  await tx.query(`CREATE TABLE IF NOT EXISTS task_history (
    id TEXT PRIMARY KEY, task_kind TEXT NOT NULL, task_id TEXT NOT NULL,
    request_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    employee_id TEXT, employee_name TEXT, action TEXT NOT NULL,
    scan_value TEXT, result TEXT NOT NULL CHECK(result IN ('accepted','rejected','observed')),
    detail TEXT NOT NULL,
    UNIQUE(task_kind,task_id,request_id,result)
  )`);
  await tx.query(
    "CREATE INDEX IF NOT EXISTS task_history_task_time ON task_history(task_kind,task_id,recorded_at DESC,id DESC)",
  );
  await tx.query(`INSERT INTO metadata(key,value) VALUES('task_history_since',clock_timestamp()::text)
    ON CONFLICT(key) DO NOTHING`);
}

/** This is scanner input, never proof that a stock operation succeeded. */
export async function recordObservedScan(
  tx: Queryable,
  state: D.WorkspaceDto,
  body: D.RecordTaskScanDto,
  employeeId: string,
  receivedAt: string,
) {
  let assigned: string | null | undefined;
  switch (body.kind) {
    case "assembly":
      assigned = state.tasks.find((row) => row.id === body.id)?.employeeId;
      break;
    case "putaway":
      assigned = state.putawayTasks.find(
        (row) => row.id === body.id,
      )?.employeeId;
      break;
    case "movement":
      assigned = state.movements.find((row) => row.id === body.id)?.employeeId;
      break;
    case "shipping":
      assigned = state.shipments.find((row) => row.id === body.id)?.employeeId;
      break;
    case "receiving":
      assigned = state.warehouse.zoneWork.find(
        (row) =>
          row.employeeId === employeeId &&
          row.jobKind === "receiving" &&
          row.jobId === body.id,
      )?.employeeId;
      break;
    case "stocktake": {
      const rows = await tx.query<{ payload: { employeeId: string | null } }>(
        "SELECT payload FROM stocktakes WHERE id=$1",
        [body.id],
      );
      assigned = rows.rows[0]?.payload.employeeId;
    }
  }
  if (assigned !== employeeId)
    throw new ForbiddenException("Сканировать можно только своё задание");
  const previous = await tx.query<{ scan_value: string; detail: string }>(
    "SELECT scan_value,detail FROM task_history WHERE task_kind=$1 AND task_id=$2 AND request_id=$3 AND result='observed'",
    [body.kind, body.id, body.requestId],
  );
  if (previous.rows.length) {
    if (
      previous.rows[0].scan_value !== body.value ||
      previous.rows[0].detail !== body.step
    )
      throw new ConflictException("Идентификатор скана уже использован");
    return;
  }
  const employee = state.employees.find((row) => row.id === employeeId);
  await tx.query(
    `INSERT INTO task_history
    (id,task_kind,task_id,request_id,received_at,employee_id,employee_name,action,scan_value,result,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7,'Скан с телефона',$8,'observed',$9)`,
    [
      randomUUID(),
      body.kind,
      body.id,
      body.requestId,
      receivedAt,
      employeeId,
      employee?.name ?? null,
      body.value,
      body.step,
    ],
  );
}

type Reference = { kind: D.TaskHistoryKind; id: string };
type Details = { action: string; scan?: string };
type Command = D.CommandDto & Record<string, unknown>;

const actions: Record<string, string> = {
  createTaskHistory: "Задание создано",
  claimTask: "Задание взято",
  assignTask: "Назначение изменено",
  updateTaskStatus: "Статус изменён",
  packTask: "Короб завершён",
  claimPutawayTask: "Размещение взято",
  takePutawayTask: "Короб забран",
  takePutawayBox: "Короб забран",
  takeAnyPutawayBox: "Короб забран",
  placePutawayTask: "Короб размещён",
  placePutawayBox: "Короб размещён",
  releasePutawayTask: "Задание возвращено в очередь",
  claimMovement: "Перемещение взято",
  takeMovement: "Паллета забрана",
  placeMovement: "Паллета размещена",
  cancelMovement: "Перемещение отменено",
  bindReceiptPalletLabel: "Этикетка паллеты привязана",
  placeReceiptPallet: "Паллета размещена",
  claimShipmentWork: "Отбор взят",
  scanShipmentWork: "Скан при отборе",
  finishShipmentWork: "Отбор завершён",
  assignWbShipment: "Исполнитель изменён",
  shipShipment: "Отправка подтверждена",
  claimStocktake: "Инвентаризация взята",
  countStocktakeLocation: "Пересчёт адреса сохранён",
  refreshStocktakeLocation: "Адрес обновлён для пересчёта",
  submitStocktake: "Пересчёт отправлен на проверку",
  approveStocktake: "Остатки утверждены",
  cancelStocktake: "Инвентаризация отменена",
  startZoneWork: "Работа в зоне открыта",
  leaveZoneWork: "Работа в зоне закрыта",
};

export function taskReference(
  state: D.WorkspaceDto,
  operation: string,
  body: D.CommandDto,
): Reference | undefined {
  const [name, id] = operation.split("/");
  if (/^(claimTask|assignTask|updateTaskStatus|scanTask|packTask)$/.test(name))
    return { kind: "assembly", id };
  if (
    /^(claimPutawayTask|takePutawayTask|takePutawayBox|placePutawayTask|placePutawayBox|releasePutawayTask)$/.test(
      name,
    )
  )
    return { kind: "putaway", id };
  if (/^(claimMovement|takeMovement|placeMovement|cancelMovement)$/.test(name))
    return { kind: "movement", id };
  if (/^(bindReceiptPalletLabel|placeReceiptPallet)$/.test(name))
    return { kind: "receiving", id };
  if (
    /^(claimShipmentWork|scanShipmentWork|finishShipmentWork|assignWbShipment|shipShipment)$/.test(
      name,
    )
  )
    return { kind: "shipping", id };
  if (name === "takeAnyPutawayBox") {
    const value = (body as D.TakePutawayBoxDto).boxCode.trim();
    const box = state.boxes.find(
      (box) => value === box.code || value === `artmate-wms:box:${box.code}`,
    );
    const task = state.putawayTasks.find(
      (task) => task.boxId === box?.id && task.status !== "completed",
    );
    if (task) return { kind: "putaway", id: task.id };
  }
  if (name === "startZoneWork" || name === "leaveZoneWork") {
    const employeeId = (body as D.ClaimTaskDto).employeeId;
    const binding = state.warehouse.zoneWork.find(
      (row) => row.employeeId === employeeId,
    );
    if (
      binding?.jobKind &&
      binding.jobId &&
      ["assembly", "receiving", "putaway", "shipping"].includes(binding.jobKind)
    )
      return { kind: binding.jobKind as D.TaskHistoryKind, id: binding.jobId };
  }
}

function commandDetails(
  operation: string,
  body: D.CommandDto,
): Details | undefined {
  const name = operation.split("/")[0];
  const command = body as Command;
  let action = actions[name];
  if (name === "scanTask") {
    action = (
      {
        source: "Скан паллеты",
        box: "Скан короба",
        barcode: "Скан товара",
      } as Record<string, string>
    )[String(command.kind)];
  }
  if (!action) return;
  if (name === "updateTaskStatus")
    action =
      command.status === "paused"
        ? "Сборка приостановлена"
        : "Сборка продолжена";
  const values = [
    "value",
    "boxCode",
    "palletCode",
    "locationCode",
    "labelCode",
    "zoneCode",
  ].flatMap((key) =>
    typeof command[key] === "string" ? [command[key] as string] : [],
  );
  return {
    action,
    scan: values.length ? values.join(" · ").slice(0, 600) : undefined,
  };
}

export async function appendTaskHistory(
  tx: Queryable,
  reference: Reference,
  state: D.WorkspaceDto,
  operation: string,
  body: D.CommandDto,
  receivedAt: string,
  result: "accepted" | "rejected",
  detail: string,
) {
  const details = commandDetails(operation, body);
  if (!details) return;
  const actor = requestAuth.getStore();
  const id = actor?.http
    ? actor.employeeId
    : (body as D.ClaimTaskDto).employeeId;
  const employee = state.employees.find((row) => row.id === id);
  await tx.query(
    `INSERT INTO task_history
    (id,task_kind,task_id,request_id,received_at,employee_id,employee_name,action,scan_value,result,detail)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      reference.kind,
      reference.id,
      body.requestId,
      receivedAt,
      employee?.id ?? null,
      employee?.name ?? null,
      details.action,
      details.scan ?? null,
      result,
      detail,
    ],
  );
}

/** Business errors roll back the command, while the rejected attempt remains auditable. */
export async function withTaskHistory<T>(
  tx: Queryable,
  getReference: () => Reference | undefined,
  state: D.WorkspaceDto,
  operation: string,
  body: D.CommandDto,
  receivedAt: string,
  execute: () => Promise<T>,
): Promise<{ value: T } | { error: HttpException }> {
  if (!commandDetails(operation, body)) return { value: await execute() };
  const before = getReference();
  await tx.query("SAVEPOINT task_history_command");
  try {
    const value = await execute();
    await tx.query("RELEASE SAVEPOINT task_history_command");
    const reference = getReference() ?? before;
    if (reference) {
      let detail = "Принято";
      if (reference.kind === "assembly") {
        const task = state.tasks.find((task) => task.id === reference.id);
        if (task)
          detail =
            task.status === "completed"
              ? "Короб завершён"
              : `В коробе ${task.scannedUnits} из ${task.unitsPerBox} шт.`;
      }
      await appendTaskHistory(
        tx,
        reference,
        state,
        operation,
        body,
        receivedAt,
        "accepted",
        detail,
      );
    }
    return { value };
  } catch (error) {
    // Storage/programming failures must roll back the complete transaction.
    if (!(error instanceof HttpException) || error.getStatus() >= 500)
      throw error;
    await tx.query("ROLLBACK TO SAVEPOINT task_history_command");
    await tx.query("RELEASE SAVEPOINT task_history_command");
    if (before)
      await appendTaskHistory(
        tx,
        before,
        state,
        operation,
        body,
        receivedAt,
        "rejected",
        error.message.slice(0, 500),
      );
    return { error };
  }
}

export async function readTaskHistory(
  tx: Queryable,
  q: D.TaskHistoryQueryDto,
): Promise<D.TaskHistoryPageDto> {
  const tables: Record<D.TaskHistoryKind, string> = {
    assembly: "tasks",
    putaway: "putawayTasks",
    movement: "movements",
    receiving: "receipts",
    shipping: "shipments",
    stocktake: "stocktakes",
  };
  const table = tables[q.kind];
  const exists = await tx.query(`SELECT id FROM ${table} WHERE id=$1`, [q.id]);
  if (!exists.rows.length) throw new NotFoundException("Задание не найдено");
  const params = [q.kind, q.id];
  const count = await tx.query<{ total: string }>(
    "SELECT count(*) AS total FROM task_history WHERE task_kind=$1 AND task_id=$2",
    params,
  );
  const page = q.page ?? 1,
    pageSize = 50;
  const rows = await tx.query<any>(
    `SELECT * FROM task_history WHERE task_kind=$1 AND task_id=$2
    ORDER BY recorded_at DESC,id DESC LIMIT $3 OFFSET $4`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const since = await tx.query<{ value: string }>(
    "SELECT value FROM metadata WHERE key='task_history_since'",
  );
  return {
    since: new Date(since.rows[0].value).toISOString(),
    total: Number(count.rows[0].total),
    page,
    pageSize,
    items: rows.rows.map((row) => ({
      id: row.id,
      receivedAt: new Date(row.received_at).toISOString(),
      recordedAt: new Date(row.recorded_at).toISOString(),
      employeeName: row.employee_name,
      action: row.action,
      scanValue: row.scan_value,
      result: row.result,
      detail: row.detail,
    })),
  };
}

export async function recordCreatedTasks(
  tx: Queryable,
  before: D.WorkspaceDto,
  state: D.WorkspaceDto,
  body: D.CommandDto,
) {
  const groups = [
    ["assembly", before.tasks, state.tasks],
    ["putaway", before.putawayTasks, state.putawayTasks],
    ["movement", before.movements, state.movements],
    ["receiving", before.receipts, state.receipts],
    ["shipping", before.shipments, state.shipments],
  ] as const;
  const receivedAt = new Date().toISOString();
  for (const [kind, previous, current] of groups) {
    const existing = new Set(previous.map(({ id }) => id));
    for (const task of current) {
      if (existing.has(task.id)) continue;
      await appendTaskHistory(
        tx,
        { kind, id: task.id },
        state,
        "createTaskHistory",
        body,
        receivedAt,
        "accepted",
        task.code,
      );
    }
  }
}
