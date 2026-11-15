"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSession } from "@/entities/session";
import type {
  AuthAccountDto,
  EmployeeDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  Badge,
  Button,
  ErrorState,
  Input,
  LoadingState,
  Modal,
} from "@/shared/ui";
import {
  accessCreateSchema,
  resetPasswordSchema,
  type AccessCreateValues,
  type ResetPasswordValues,
} from "../lib/access-form";
import {
  accessDate,
  accessRoleLabels,
  isLastManager,
} from "../lib/access-policy";
import { useAccessManagement } from "../model/use-access-management";
import { RoleFields } from "./role-fields";
import styles from "./access.module.css";
export function AccessManagementFeature({
  data,
  employee,
}: {
  data: WorkspaceDto;
  employee?: EmployeeDto;
}) {
  const session = useSession();
  const model = useAccessManagement();
  const [creating, setCreating] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const accounts = model.query.data?.items ?? [];
  const resetAccount = accounts.find((item) => item.id === resetId);
  const revokeAccount = accounts.find((item) => item.id === revokeId);
  if (!session.isManager) return null;
  const employeeAccount =
    employee && accounts.find(({ employeeId }) => employeeId === employee.id);
  const visibleAccounts = employee
    ? employeeAccount
      ? [employeeAccount]
      : []
    : accounts.filter(
        ({ employeeId }) => !data.employees.some(({ id }) => id === employeeId),
      );
  const renderAccount = (account: AuthAccountDto) => (
    <AccountCard
      key={account.id}
      account={account}
      accounts={accounts}
      own={account.id === session.user?.id}
      pending={model.pending}
      onRole={async (role) => {
        const success = await model.update(account.id, { role });
        if (success) setNotice("Роль сохранена.");
        return success;
      }}
      onBlock={async () => {
        if (await model.update(account.id, { blocked: !account.blocked })) {
          setNotice(
            account.blocked ? "Вход снова разрешён." : "Вход заблокирован.",
          );
        }
      }}
      onReset={() => {
        model.clearError();
        setResetId(account.id);
      }}
      onRevoke={() => {
        model.clearError();
        setRevokeId(account.id);
      }}
    />
  );
  if (!employee && visibleAccounts.length === 0) return null;

  return (
    <section
      className={styles.feature}
      aria-label={employee ? "Доступ" : "Отдельные учётные записи"}
    >
      {employee ? (
        <>
          <h3>Доступ</h3>
          {model.query.isPending ? (
            <p className={styles.help} role="status">
              Загружаем доступ…
            </p>
          ) : model.query.isError && !model.query.data ? (
            <p className={styles.error} role="alert">
              Не удалось загрузить доступ.{" "}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void model.query.refetch()}
              >
                Повторить
              </Button>
            </p>
          ) : employeeAccount ? (
            renderAccount(employeeAccount)
          ) : (
            <div className={styles.actions}>
              <span className={styles.help}>Учётной записи нет</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={model.pending}
                onClick={() => {
                  model.clearError();
                  setCreating(true);
                }}
              >
                Создать доступ
              </Button>
            </div>
          )}
        </>
      ) : (
        <details className={styles.disclosure}>
          <summary>Отдельные учётные записи</summary>
          {visibleAccounts.map((account) => (
            <details key={account.id} className={styles.accountDisclosure}>
              <summary>{account.name}</summary>
              {renderAccount(account)}
            </details>
          ))}
        </details>
      )}
      {model.query.isError && model.query.data && (
        <p className={styles.error} role="status">
          Не удалось обновить доступ. Показаны последние данные.
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {model.error && !creating && !resetId && !revokeId && (
        <p className={styles.error} role="alert">
          {model.error}
        </p>
      )}
      {creating && employee && !employeeAccount && (
        <CreateAccessForm
          employee={employee}
          pending={model.pending}
          error={model.error}
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            if (await model.create(values)) {
              setCreating(false);
              setNotice(
                "Доступ создан. При первом входе сотрудник сменит временный пароль.",
              );
            }
          }}
        />
      )}
      {resetAccount && (
        <ResetAccessForm
          account={resetAccount}
          pending={model.pending}
          error={model.error}
          onClose={() => setResetId(null)}
          onSave={async (values) => {
            if (await model.reset(resetAccount.id, values)) {
              setResetId(null);
              setNotice(
                `Временный пароль для ${resetAccount.name} установлен; все его сеансы завершены.`,
              );
            }
          }}
        />
      )}
      {revokeAccount && (
        <Modal
          open
          title={`Завершить сеансы: ${revokeAccount.name}`}
          description={`Логин ${revokeAccount.login}. Для продолжения работы потребуется новый вход.`}
          onClose={() => {
            if (!model.pending) setRevokeId(null);
          }}
        >
          <div className={styles.form}>
            <p className={styles.info}>
              Активных сеансов: {revokeAccount.activeSessions}
            </p>
            {model.error && (
              <p className={styles.error} role="alert">
                {model.error}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                disabled={model.pending}
                onClick={() => setRevokeId(null)}
              >
                Отмена
              </Button>
              <Button
                variant="danger"
                disabled={model.pending}
                aria-busy={model.pending}
                onClick={async () => {
                  if (await model.revoke(revokeAccount.id)) {
                    setRevokeId(null);
                    setNotice(`Сеансы для ${revokeAccount.name} завершены.`);
                  }
                }}
              >
                Завершить все сеансы
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
function AccountCard({
  account,
  accounts,
  own,
  pending,
  onRole,
  onBlock,
  onReset,
  onRevoke,
}: {
  account: AuthAccountDto;
  accounts: AuthAccountDto[];
  own: boolean;
  pending: boolean;
  onRole: (role: "manager" | "employee") => Promise<boolean>;
  onBlock: () => Promise<void>;
  onReset: () => void;
  onRevoke: () => void;
}) {
  const [role, setRole] = useState(account.role);
  const [touched, setTouched] = useState(false);
  const dirty = role !== account.role;
  useEffect(() => {
    if (!touched) setRole(account.role);
  }, [account.role, touched]);
  const last = isLastManager(account, accounts);
  return (
    <div className={styles.account}>
      <div className={styles.accountHeader}>
        <span>
          Логин <b>{account.login}</b>
          {own && " · вы"}
        </span>
        <Badge tone={account.blocked ? "danger" : "neutral"}>
          {account.blocked
            ? "Вход заблокирован"
            : accessRoleLabels[account.role]}
        </Badge>
      </div>
      <div className={styles.facts}>
        <span>Последний вход: {accessDate(account.lastLoginAt)}</span>
        <span>Активных сеансов: {account.activeSessions}</span>
        {account.mustChangePassword && <span>Ожидает смены пароля</span>}
      </div>
      <div className={styles.roleForm}>
        <RoleFields
          value={role}
          onChange={(value) => {
            setRole(value);
            setTouched(value !== account.role);
          }}
          disabled={pending}
          lastManager={last}
        />
        {last && <p className={styles.help}>Последний активный руководитель</p>}
        {dirty && (
          <div>
            <p className={styles.help}>Смена роли завершит все сеансы.</p>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || (last && role === "employee")}
              onClick={async () => {
                if (await onRole(role)) setTouched(false);
              }}
            >
              Сохранить роль
            </Button>
          </div>
        )}
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.actions}>
          {(!last || account.blocked) && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => void onBlock()}
            >
              {account.blocked ? "Разрешить вход" : "Заблокировать вход"}
            </Button>
          )}
          {!own && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={onReset}
            >
              Сбросить пароль
            </Button>
          )}
          {account.activeSessions > 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={onRevoke}
            >
              Завершить сеансы
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
function CreateAccessForm({
  employee,
  pending,
  error,
  onClose,
  onSave,
}: {
  employee: EmployeeDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: AccessCreateValues) => Promise<void>;
}) {
  const form = useForm<AccessCreateValues>({
    resolver: zodResolver(accessCreateSchema),
    defaultValues: {
      employeeId: employee.id,
      login: "",
      password: "",
      role: "employee",
    },
  });
  return (
    <Modal
      open
      title={`Создать доступ для ${employee.name}`}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        noValidate
        className={styles.form}
        aria-busy={pending}
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending) await onSave(values);
        })}
      >
        <fieldset disabled={pending} className={styles.fieldset}>
          <label className="field">
            Логин
            <Input
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              {...form.register("login")}
              aria-invalid={!!form.formState.errors.login}
            />
            {form.formState.errors.login && (
              <span className={styles.error}>
                {form.formState.errors.login.message}
              </span>
            )}
          </label>
          <label className="field">
            Временный пароль
            <Input
              type="password"
              autoComplete="new-password"
              {...form.register("password")}
              aria-invalid={!!form.formState.errors.password}
            />
            {form.formState.errors.password && (
              <span className={styles.error}>
                {form.formState.errors.password.message}
              </span>
            )}
          </label>
          <RoleFields
            value={form.watch("role")}
            onChange={(role) =>
              form.setValue("role", role, { shouldDirty: true })
            }
            disabled={pending}
          />
        </fieldset>
        <p className={styles.help}>
          Минимум 12 символов. Сотрудник сменит пароль при первом входе.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            Создать доступ
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ResetAccessForm({
  account,
  pending,
  error,
  onClose,
  onSave,
}: {
  account: AuthAccountDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: ResetPasswordValues) => Promise<void>;
}) {
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });
  return (
    <Modal
      open
      title={`Временный пароль: ${account.name}`}
      description={`Логин ${account.login}. Сброс завершит все сеансы. Сотрудник сменит пароль при следующем входе.`}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        noValidate
        className={styles.form}
        aria-busy={pending}
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending) await onSave(values);
        })}
      >
        <label className="field">
          Новый временный пароль
          <Input
            type="password"
            autoComplete="new-password"
            disabled={pending}
            {...form.register("password")}
            aria-invalid={!!form.formState.errors.password}
          />
          {form.formState.errors.password && (
            <span className={styles.error}>
              {form.formState.errors.password.message}
            </span>
          )}
        </label>
        <p className={styles.help}>От 12 до 128 символов.</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            Установить временный пароль
          </Button>
        </div>
      </form>
    </Modal>
  );
}
