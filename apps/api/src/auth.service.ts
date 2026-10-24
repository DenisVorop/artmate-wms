import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  HttpException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import * as D from "./dto";
import { WarehouseService } from "./warehouse.service";
import { Queryable } from "./database";
import { requestAuth } from "./auth-context";
import {
  AccountRow,
  authAudit,
  authUser,
  sessionRow,
  randomToken,
  hashToken,
  passwordHash,
  passwordMatches,
} from "./auth-storage";
import { requireAuth, requireOrigin } from "./auth-policy";
const dummyPassword = passwordHash("Dummy password for unknown local account");
const iso = (value: string | Date) => new Date(value).toISOString();
export interface AuthResult {
  session: D.AuthSessionDto;
  token: string;
}
@Injectable()
export class AuthService {
  constructor(
    @Inject(WarehouseService) private readonly warehouse: WarehouseService,
  ) {}
  private _transaction<T>(fn: (tx: Queryable) => Promise<T>) {
    return this.warehouse.authTransaction(fn);
  }
  async getAuthSession(): Promise<D.AuthSessionDto> {
    return this._transaction(async (tx) => {
      const setup = await tx.query("SELECT id FROM auth_accounts LIMIT 1");
      const row = await sessionRow(
        tx,
        requestAuth.getStore()?.tokenHash ?? null,
      );
      return {
        needsSetup: !setup.rows.length,
        user: row ? authUser(row) : null,
        csrfToken: row?.csrf_token ?? null,
        expiresAt: row ? iso(row.expires_at) : null,
      };
    });
  }
  private async _newSession(
    tx: Queryable,
    row: AccountRow,
    kind = "login",
  ): Promise<AuthResult> {
    const token = randomToken(),
      csrfToken = randomToken(),
      expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await tx.query("DELETE FROM auth_sessions WHERE expires_at<=NOW()");
    await tx.query(
      "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), row.id, hashToken(token), csrfToken, expiresAt],
    );
    await authAudit(tx, kind, row);
    return {
      token,
      session: { needsSetup: false, user: authUser(row), csrfToken, expiresAt },
    };
  }
  private async _reserveAttempt(login: string, ip: string) {
    const limited = await this._transaction(async (tx) => {
      await tx.query(
        "DELETE FROM auth_login_limits WHERE window_start<NOW()-INTERVAL '1 day'",
      );
      for (const [key, limit] of [
        [`ip:${hashToken(ip)}`, 30],
        [`login:${hashToken(login)}`, 5],
      ] as const) {
        const size = await tx.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM auth_login_limits",
        );
        const existing = await tx.query<{ attempts: number; expired: boolean }>(
          "SELECT attempts,window_start<NOW()-INTERVAL '15 minutes' AS expired FROM auth_login_limits WHERE key=$1",
          [key],
        );
        if (!existing.rows.length && Number(size.rows[0].count) >= 10000)
          return true;
        const row = existing.rows[0];
        if (row && !row.expired && row.attempts >= limit) return true;
        await tx.query(
          "INSERT INTO auth_login_limits(key,window_start,attempts) VALUES($1,NOW(),1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_login_limits.window_start<NOW()-INTERVAL '15 minutes' THEN 1 ELSE auth_login_limits.attempts+1 END,window_start=CASE WHEN auth_login_limits.window_start<NOW()-INTERVAL '15 minutes' THEN NOW() ELSE auth_login_limits.window_start END",
          [key],
        );
      }
      return false;
    });
    if (limited)
      throw new HttpException(
        "Слишком много попыток. Повторите через 15 минут",
        429,
      );
  }
  async setupAuth(b: D.SetupAuthDto, ip: string): Promise<AuthResult> {
    requireOrigin(requestAuth.getStore()?.origin ?? null);
    if (!(await this.getAuthSession()).needsSetup)
      throw new ConflictException("Первый руководитель уже создан");
    await this._reserveAttempt("setup", ip);
    const encoded = await passwordHash(b.password);
    return this._transaction(async (tx) => {
      if ((await tx.query("SELECT id FROM auth_accounts LIMIT 1")).rows.length)
        throw new ConflictException("Первый руководитель уже создан");
      const employeeId = randomUUID(),
        id = randomUUID();
      await tx.query("INSERT INTO employees(id,payload) VALUES($1,$2)", [
        employeeId,
        JSON.stringify({
          id: employeeId,
          name: b.name,
          initials: b.name
            .split(/\s+/)
            .slice(0, 2)
            .map((x) => x[0])
            .join("")
            .toUpperCase(),
          role: "Руководитель",
          status: "off",
          boxesToday: 0,
          unitsToday: 0,
        }),
      ]);
      await tx.query(
        "UPDATE metadata SET value=((value::bigint)+1)::text WHERE key='workspace_revision'",
      );
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,'manager',FALSE)",
        [id, employeeId, b.login, encoded],
      );
      return this._newSession(
        tx,
        {
          id,
          employee_id: employeeId,
          login: b.login,
          name: b.name,
          role: "manager",
          must_change_password: false,
        } as AccountRow,
        "setup",
      );
    });
  }
  async login(b: D.LoginDto, ip: string): Promise<AuthResult> {
    requireOrigin(requestAuth.getStore()?.origin ?? null);
    await this._reserveAttempt(b.login, ip);
    const row = await this._transaction(
      async (tx) =>
        (
          await tx.query<AccountRow>(
            "SELECT a.*,e.payload->>'name' AS name FROM auth_accounts a JOIN employees e ON e.id=a.employee_id WHERE a.login=$1",
            [b.login],
          )
        ).rows[0],
    );
    const valid = await passwordMatches(
      b.password,
      row?.password_hash ?? (await dummyPassword),
    );
    if (!row || !valid || row.blocked)
      throw new UnauthorizedException("Неверный логин или пароль");
    return this._transaction(async (tx) => {
      const fresh = (
        await tx.query<AccountRow>(
          "SELECT a.*,e.payload->>'name' AS name FROM auth_accounts a JOIN employees e ON e.id=a.employee_id WHERE a.id=$1",
          [row.id],
        )
      ).rows[0];
      if (!fresh || fresh.blocked || fresh.password_hash !== row.password_hash)
        throw new UnauthorizedException("Неверный логин или пароль");
      await tx.query(
        "UPDATE auth_accounts SET last_login_at=NOW() WHERE id=$1",
        [row.id],
      );
      await tx.query("DELETE FROM auth_login_limits WHERE key=$1", [
        `login:${hashToken(b.login)}`,
      ]);
      return this._newSession(tx, fresh);
    });
  }
  async logout(): Promise<D.AuthSessionDto> {
    await this._transaction(async (tx) => {
      const row = await requireAuth(tx, true, true);
      await tx.query("DELETE FROM auth_sessions WHERE id=$1", [row.session_id]);
      await authAudit(tx, "logout", row);
    });
    return this.getAuthSession();
  }
  async changePassword(b: D.ChangePasswordDto): Promise<AuthResult> {
    const row = await this._transaction((tx) => requireAuth(tx, true, true));
    if (!(await passwordMatches(b.currentPassword, row.password_hash)))
      throw new UnauthorizedException("Текущий пароль указан неверно");
    if (b.currentPassword === b.newPassword)
      throw new BadRequestException(
        "Новый пароль должен отличаться от текущего",
      );
    const encoded = await passwordHash(b.newPassword);
    return this._transaction(async (tx) => {
      const fresh = await requireAuth(tx, true, true);
      if (fresh.password_hash !== row.password_hash)
        throw new ConflictException("Пароль уже изменён. Войдите снова");
      await tx.query(
        "UPDATE auth_accounts SET password_hash=$2,must_change_password=FALSE WHERE id=$1",
        [fresh.id, encoded],
      );
      await tx.query("DELETE FROM auth_sessions WHERE account_id=$1", [
        fresh.id,
      ]);
      return this._newSession(
        tx,
        { ...fresh, must_change_password: false },
        "password_changed",
      );
    });
  }
  private async _manager(tx: Queryable, write = false) {
    const row = await requireAuth(tx, write);
    if (row.role !== "manager")
      throw new ForbiddenException("Нужны права руководителя");
    return row;
  }
  private async _accounts(tx: Queryable): Promise<D.AuthAccountsDto> {
    const rows = await tx.query<AccountRow & { active_sessions: string }>(
      "SELECT a.*,e.payload->>'name' AS name,(SELECT COUNT(*) FROM auth_sessions s WHERE s.account_id=a.id AND s.expires_at>NOW()) AS active_sessions FROM auth_accounts a JOIN employees e ON e.id=a.employee_id ORDER BY a.created_at,a.id",
    );
    return {
      items: rows.rows.map((row) => ({
        ...authUser(row),
        blocked: row.blocked,
        createdAt: iso(row.created_at),
        lastLoginAt: row.last_login_at ? iso(row.last_login_at) : null,
        activeSessions: Number(row.active_sessions),
      })),
    };
  }
  getAuthAccounts() {
    return this._transaction(async (tx) => {
      await this._manager(tx);
      return this._accounts(tx);
    });
  }
  async createAuthAccount(b: D.CreateAuthAccountDto) {
    await this._transaction((tx) => this._manager(tx, true));
    const encoded = await passwordHash(b.password);
    return this._transaction(async (tx) => {
      const actor = await this._manager(tx, true);
      if (
        !(
          await tx.query("SELECT id FROM employees WHERE id=$1", [b.employeeId])
        ).rows.length
      )
        throw new BadRequestException("Сотрудник не найден");
      if (
        (
          await tx.query(
            "SELECT id FROM auth_accounts WHERE employee_id=$1 OR login=$2",
            [b.employeeId, b.login],
          )
        ).rows.length
      )
        throw new ConflictException(
          "Логин или аккаунт сотрудника уже существует",
        );
      const id = randomUUID();
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, b.employeeId, b.login, encoded, b.role],
      );
      await authAudit(tx, "account_created", actor, id);
      return this._accounts(tx);
    });
  }
  updateAuthAccount(id: string, b: D.UpdateAuthAccountDto) {
    return this._transaction(async (tx) => {
      const actor = await this._manager(tx, true);
      const row = (
        await tx.query<AccountRow>("SELECT * FROM auth_accounts WHERE id=$1", [
          id,
        ])
      ).rows[0];
      if (!row) throw new BadRequestException("Аккаунт не найден");
      if (b.role === undefined && b.blocked === undefined)
        throw new BadRequestException("Укажите роль или статус");
      const role = b.role ?? row.role,
        blocked = b.blocked ?? row.blocked;
      if (
        row.role === "manager" &&
        !row.blocked &&
        (role !== "manager" || blocked)
      ) {
        const count = await tx.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM auth_accounts WHERE role='manager' AND blocked=FALSE",
        );
        if (Number(count.rows[0].count) <= 1)
          throw new ConflictException(
            "Нельзя отключить последнего руководителя",
          );
      }
      await tx.query(
        "UPDATE auth_accounts SET role=$2,blocked=$3 WHERE id=$1",
        [id, role, blocked],
      );
      if (role !== row.role || blocked !== row.blocked)
        await tx.query("DELETE FROM auth_sessions WHERE account_id=$1", [id]);
      await authAudit(tx, "account_updated", actor, id);
      return this._accounts(tx);
    });
  }
  async resetAuthPassword(id: string, b: D.ResetAuthPasswordDto) {
    const current = await this._transaction((tx) => this._manager(tx, true));
    if (id === current.id)
      throw new BadRequestException(
        "Для своего аккаунта используйте смену пароля",
      );
    const encoded = await passwordHash(b.password);
    return this._transaction(async (tx) => {
      const actor = await this._manager(tx, true);
      const exists = await tx.query(
        "SELECT id FROM auth_accounts WHERE id=$1",
        [id],
      );
      if (!exists.rows.length)
        throw new BadRequestException("Аккаунт не найден");
      await tx.query(
        "UPDATE auth_accounts SET password_hash=$2,must_change_password=TRUE WHERE id=$1",
        [id, encoded],
      );
      await tx.query("DELETE FROM auth_sessions WHERE account_id=$1", [id]);
      await authAudit(tx, "password_reset", actor, id);
      return this._accounts(tx);
    });
  }
  revokeAuthSessions(id: string) {
    return this._transaction(async (tx) => {
      const actor = await this._manager(tx, true);
      if (
        !(await tx.query("SELECT id FROM auth_accounts WHERE id=$1", [id])).rows
          .length
      )
        throw new BadRequestException("Аккаунт не найден");
      await tx.query("DELETE FROM auth_sessions WHERE account_id=$1", [id]);
      await authAudit(tx, "sessions_revoked", actor, id);
      return this._accounts(tx);
    });
  }
}
