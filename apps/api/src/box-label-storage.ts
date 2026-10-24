import { BadRequestException } from "@nestjs/common";
import { Queryable } from "./database";
import * as D from "./dto";
export async function initializeBoxLabels(tx: Queryable) {
  for (const sql of `CREATE TABLE IF NOT EXISTS box_label_batches (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL, account_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preprinted_box_labels (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES box_label_batches(id), ordinal INTEGER NOT NULL,
    code TEXT UNIQUE NOT NULL, task_id TEXT, box_id TEXT, assigned_at TIMESTAMPTZ,
    UNIQUE(batch_id,ordinal));
    CREATE TABLE IF NOT EXISTS box_label_commands (
    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS preprinted_box_labels_batch ON preprinted_box_labels(batch_id,ordinal);`
    .split(";")
    .filter((s) => s.trim()))
    await tx.query(sql);
}
export function boxScanCode(value: string) {
  return value.startsWith("artmate-wms:box:")
    ? value.slice("artmate-wms:box:".length)
    : value;
}
export async function confirmBoxLabel(
  tx: Queryable,
  task: D.TaskDto,
  value: string,
) {
  const code = boxScanCode(value);
  const result = await tx.query<{ task_id: string | null }>(
    "SELECT task_id FROM preprinted_box_labels WHERE code=$1",
    [code],
  );
  const registered = result.rows[0];
  if (registered) {
    if (
      registered.task_id &&
      (registered.task_id !== task.id || task.openBoxCode !== code)
    )
      throw new BadRequestException(
        "Эта этикетка уже закреплена за другим коробом. Возьмите новую",
      );
    if (task.boxCodeConfirmed && task.openBoxCode !== code)
      throw new BadRequestException("Сначала закончите текущий короб");
    if (!registered.task_id) {
      await tx.query(
        "UPDATE preprinted_box_labels SET task_id=$1,assigned_at=$2 WHERE code=$3 AND task_id IS NULL",
        [task.id, new Date().toISOString(), code],
      );
      task.openBoxCode = code;
    }
    return;
  }
  if (code !== task.openBoxCode)
    throw new BadRequestException(
      code.startsWith("BOX-PRE-")
        ? "Этикетка не зарегистрирована. Возьмите этикетку из напечатанного запаса"
        : "Отсканируйте код текущего короба или свободную этикетку",
    );
}
export async function closeBoxLabels(
  tx: Queryable,
  before: D.WorkspaceDto,
  state: D.WorkspaceDto,
) {
  const oldIds = new Set(before.boxes.map((b) => b.id));
  for (const box of state.boxes) {
    if (oldIds.has(box.id)) continue;
    await tx.query(
      "UPDATE preprinted_box_labels SET box_id=$1 WHERE code=$2 AND task_id IS NOT NULL AND box_id IS NULL",
      [box.id, box.code],
    );
  }
}
