import { BadRequestException } from "@nestjs/common";
import type { Queryable } from "./database";
import type { PalletDto } from "./dto";
export async function initializePalletLabels(tx: Queryable) {
  for (const sql of `CREATE TABLE IF NOT EXISTS pallet_label_batches (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, count INTEGER NOT NULL CHECK(count BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL, account_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preprinted_pallet_labels (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES pallet_label_batches(id), ordinal INTEGER NOT NULL,
    code TEXT UNIQUE NOT NULL, pallet_id TEXT UNIQUE, receipt_id TEXT, assigned_at TIMESTAMPTZ,
    UNIQUE(batch_id,ordinal));
    CREATE TABLE IF NOT EXISTS pallet_label_commands (
    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS preprinted_pallet_labels_batch ON preprinted_pallet_labels(batch_id,ordinal);`
    .split(";")
    .filter((s) => s.trim()))
    await tx.query(sql);
}
export async function bindPalletLabel(
  tx: Queryable,
  receiptId: string,
  pallet: PalletDto,
  value: string,
) {
  const code = value.startsWith("artmate-wms:pallet:")
    ? value.slice("artmate-wms:pallet:".length)
    : value;
  const label = (
    await tx.query<{
      id: string;
      pallet_id: string | null;
      receipt_id: string | null;
    }>(
      "SELECT id,pallet_id,receipt_id FROM preprinted_pallet_labels WHERE code=$1",
      [code],
    )
  ).rows[0];
  if (!label)
    throw new BadRequestException(
      "Этикетка паллеты не зарегистрирована. Возьмите этикетку из напечатанного запаса",
    );
  if (label.pallet_id) {
    if (
      label.pallet_id !== pallet.id ||
      label.receipt_id !== receiptId ||
      pallet.code !== code
    )
      throw new BadRequestException(
        "Эта этикетка уже закреплена за другой паллетой. Возьмите новую",
      );
    return;
  }
  const bound = (
    await tx.query(
      "SELECT id FROM preprinted_pallet_labels WHERE pallet_id=$1",
      [pallet.id],
    )
  ).rows[0];
  if (bound)
    throw new BadRequestException(
      "У паллеты уже есть этикетка. Отсканируйте ранее наклеенную",
    );
  const rows = await tx.query(
    "UPDATE preprinted_pallet_labels SET pallet_id=$1,receipt_id=$2,assigned_at=$3 WHERE id=$4 AND pallet_id IS NULL RETURNING id",
    [pallet.id, receiptId, new Date().toISOString(), label.id],
  );
  if (rows.rows.length !== 1)
    throw new BadRequestException("Этикетка уже занята. Возьмите новую");
  pallet.code = code;
}
