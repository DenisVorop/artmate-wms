import type { Queryable } from "../database";
import type { ForecastJournalRun } from "./journal-types";
import type { ForecastJournalListDto } from "./journal-dto";
import { forecastJournalSummary } from "./journal-comparison";

export async function initializeForecastJournalStorage(tx: Queryable) {
  await tx.query(
    "CREATE TABLE IF NOT EXISTS forecast_journal (id TEXT PRIMARY KEY, published_at TIMESTAMPTZ NOT NULL, scope_keys TEXT[] NOT NULL, payload JSONB NOT NULL)",
  );
  await tx.query(
    "CREATE INDEX IF NOT EXISTS forecast_journal_publication ON forecast_journal(published_at DESC,id DESC)",
  );
  await tx.query(
    "CREATE INDEX IF NOT EXISTS forecast_journal_scopes ON forecast_journal USING GIN(scope_keys)",
  );
}
/** Append only. A retry cannot overwrite what the system actually published. */
export async function appendForecastJournal(
  tx: Queryable,
  run: ForecastJournalRun,
): Promise<boolean> {
  const result = await tx.query<{ id: string }>(
    "INSERT INTO forecast_journal(id,published_at,scope_keys,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id",
    [
      run.id,
      run.publishedAt,
      run.series.map((s) => s.scopeKey),
      JSON.stringify(run),
    ],
  );
  return result.rows.length === 1;
}
function scopedRun(
  run: ForecastJournalRun,
  scopeKeys: string[],
): ForecastJournalRun {
  const active = new Set(scopeKeys);
  return {
    ...run,
    series: run.series.filter((s) => active.has(s.scopeKey)),
    observedActuals: run.observedActuals?.filter((fact) =>
      active.has(fact.scopeKey),
    ),
  };
}
export async function readForecastJournal(
  tx: Queryable,
  id: string,
  scopeKeys: string[],
): Promise<ForecastJournalRun | undefined> {
  if (!scopeKeys.length) return undefined;
  const run = (
    await tx.query<{ payload: ForecastJournalRun }>(
      "SELECT payload FROM forecast_journal WHERE id=$1 AND scope_keys && $2::text[]",
      [id, scopeKeys],
    )
  ).rows[0]?.payload;
  return run ? scopedRun(run, scopeKeys) : undefined;
}
export async function listForecastJournal(
  tx: Queryable,
  options: { scopeKeys: string[]; limit?: number; cursor?: string },
): Promise<ForecastJournalListDto> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error("Invalid forecast journal page size");
  if (!options.scopeKeys.length) return { runs: [], nextCursor: null };
  const result = await tx.query<{ payload: ForecastJournalRun }>(
    `SELECT payload FROM forecast_journal WHERE scope_keys && $1::text[]
      AND ($2::text IS NULL OR (published_at,id)<(SELECT published_at,id FROM forecast_journal WHERE id=$2 AND scope_keys && $1::text[]))
      ORDER BY published_at DESC,id DESC LIMIT $3`,
    [options.scopeKeys, options.cursor ?? null, limit + 1],
  );
  const runs = result.rows
    .slice(0, limit)
    .map((r) => scopedRun(r.payload, options.scopeKeys));
  return {
    runs: runs.map(forecastJournalSummary),
    nextCursor: result.rows.length > limit ? runs.at(-1)!.id : null,
  };
}
/** Bounded worker input: one latest published vintage per Moscow day, not all 48 refreshes. */
export async function readForecastJournalFeedback(
  tx: Queryable,
  scopeKeys: string[],
  asOf: string,
): Promise<ForecastJournalRun[]> {
  if (!scopeKeys.length) return [];
  const result = await tx.query<{ payload: ForecastJournalRun }>(
    `SELECT payload FROM (SELECT DISTINCT ON ((published_at AT TIME ZONE 'Europe/Moscow')::date)
      payload,published_at,id FROM forecast_journal
      WHERE scope_keys && $1::text[]
        AND published_at>=($2::date-INTERVAL '120 days') AT TIME ZONE 'Europe/Moscow'
        AND published_at<($2::date+INTERVAL '1 day') AT TIME ZONE 'Europe/Moscow'
      ORDER BY (published_at AT TIME ZONE 'Europe/Moscow')::date DESC,published_at DESC,id DESC
    ) selected ORDER BY published_at DESC,id DESC LIMIT 121`,
    [scopeKeys, asOf],
  );
  return result.rows.map((r) => scopedRun(r.payload, scopeKeys));
}
