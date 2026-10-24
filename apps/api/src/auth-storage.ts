import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { Queryable } from "./database";
import * as D from "./dto";
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export async function passwordHash(password: string) {
  const salt = randomBytes(16);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join("$") !== "scrypt$32768$8$3" ||
    !/^[a-f0-9]{32}$/.test(parts[4]) ||
    !/^[a-f0-9]{64}$/.test(parts[5])
  )
    return false;
  const key = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(key, Buffer.from(parts[5], "hex"));
}
export async function initializeAuth(tx: Queryable) {
  await tx.query(
    `CREATE TABLE IF NOT EXISTS auth_accounts(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL UNIQUE REFERENCES employees(id),login TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('manager','employee')),blocked BOOLEAN NOT NULL DEFAULT FALSE,must_change_password BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_login_at TIMESTAMPTZ)`,
  );
  await tx.query(
    `CREATE TABLE IF NOT EXISTS auth_sessions(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES auth_accounts(id),token_hash TEXT NOT NULL UNIQUE,csrf_token TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL)`,
  );
  await tx.query(
    `CREATE INDEX IF NOT EXISTS auth_sessions_account_idx ON auth_sessions(account_id)`,
  );
  await tx.query(
    `CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at)`,
  );
  await tx.query(
    `CREATE TABLE IF NOT EXISTS auth_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,actor_account_id TEXT,actor_employee_id TEXT,target_account_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  );
  await tx.query(
    `CREATE TABLE IF NOT EXISTS auth_login_limits(key TEXT PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL)`,
  );
}
export interface AccountRow {
  id: string;
  employee_id: string;
  login: string;
  password_hash: string;
  role: "manager" | "employee";
  blocked: boolean;
  must_change_password: boolean;
  created_at: string | Date;
  last_login_at: string | Date | null;
  name: string;
}
export interface SessionRow extends AccountRow {
  session_id: string;
  csrf_token: string;
  expires_at: string | Date;
}
export function authUser(row: AccountRow): D.AuthUserDto {
  return {
    id: row.id,
    employeeId: row.employee_id,
    login: row.login,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password,
  };
}
export async function sessionRow(
  tx: Queryable,
  hash: string | null,
): Promise<SessionRow | null> {
  if (!hash) return null;
  const result = await tx.query<SessionRow>(
    `SELECT a.*,e.payload->>'name' AS name,s.id AS session_id,s.csrf_token,s.expires_at FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id JOIN employees e ON e.id=a.employee_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND a.blocked=FALSE`,
    [hash],
  );
  return result.rows[0] ?? null;
}

export async function authAudit(
  tx: Queryable,
  kind: string,
  actor: Pick<AccountRow, "id" | "employee_id">,
  targetId = actor.id,
) {
  await tx.query(
    "INSERT INTO auth_events(id,kind,actor_account_id,actor_employee_id,target_account_id) VALUES($1,$2,$3,$4,$5)",
    [randomToken(), kind, actor.id, actor.employee_id, targetId],
  );
}
