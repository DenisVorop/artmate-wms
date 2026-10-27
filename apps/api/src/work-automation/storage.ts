import type { Queryable } from "../database";
import type {
  AutomationRuntime,
  AutomationSettings,
  AutomaticTaskOrigin,
} from "./types";
export async function initializeWorkAutomationStorage(tx: Queryable) {
  for (const table of ["automation_settings", "automation_tasks"])
    await tx.query(
      `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`,
    );
  await tx.query(
    "CREATE TABLE IF NOT EXISTS automation_commands(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response JSONB NOT NULL)",
  );
}
export async function automationSettings(
  tx: Queryable,
): Promise<AutomationSettings> {
  return (
    (
      await tx.query<{ payload: AutomationSettings }>(
        "SELECT payload FROM automation_settings WHERE id='common'",
      )
    ).rows[0]?.payload ?? {
      enabled: true,
      updatedAt: null,
      actorAccountId: null,
    }
  );
}
export async function automationRuntime(
  tx: Queryable,
): Promise<AutomationRuntime> {
  return (
    (
      await tx.query<{ payload: AutomationRuntime }>(
        "SELECT payload FROM automation_settings WHERE id='runtime'",
      )
    ).rows[0]?.payload ?? {
      lastCheckedAt: null,
      message: "Задания появляются автоматически по плану сборки.",
      blockers: [],
    }
  );
}
export async function automationOrigins(
  tx: Queryable,
): Promise<AutomaticTaskOrigin[]> {
  return (
    await tx.query<{ payload: AutomaticTaskOrigin }>(
      "SELECT payload FROM automation_tasks ORDER BY id",
    )
  ).rows.map((row) => row.payload);
}
export async function saveAutomationSetting(
  tx: Queryable,
  id: "common" | "runtime",
  value: AutomationSettings | AutomationRuntime,
) {
  await tx.query(
    "INSERT INTO automation_settings(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
    [id, JSON.stringify(value)],
  );
}
export async function saveAutomationOrigin(
  tx: Queryable,
  value: AutomaticTaskOrigin,
) {
  await tx.query(
    "INSERT INTO automation_tasks(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
    [value.taskId, JSON.stringify(value)],
  );
}
