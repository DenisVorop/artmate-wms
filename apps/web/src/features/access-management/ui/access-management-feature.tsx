"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import { useSession } from "@/entities/session";
import type {
  AuthAccountDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
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
export function AccessManagementFeature({ data }: { data: WorkspaceDto }) {
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
  return (
    <section className={styles.feature} aria-label="Доступ сотрудников">
      <div className={styles.header}>
        <div>
          <h2>
            <ShieldCheck size={21} />
            Доступ сотрудников
          </h2>
          <p>
            Личные учётные записи связаны с существующими сотрудниками. Аккаунты
            и история не удаляются.
          </p>
        </div>
        <Button
          disabled={model.pending}
          onClick={() => {
            model.clearError();
            setCreating(true);
          }}
        >
          <Plus size={16} />
          Создать доступ
        </Button>
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {model.query.isPending ? (
        <LoadingState label="Загружаем учётные записи…" />
      ) : model.query.isError && !model.query.data ? (
        <ErrorState onRetry={() => void model.query.refetch()} />
      ) : (
        <>
          {model.query.isError && (
            <p className={styles.error} role="alert">
              Не удалось обновить список. Показаны последние данные.
            </p>
          )}
          <div className={styles.cards}>
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                accounts={accounts}
                own={account.id === session.user?.id}
                pending={model.pending}
                onRole={async (role) => {
                  const success = await model.update(account.id, { role });
                  if (success)
                    setNotice(
                      `Роль для ${account.name} сохранена. Изменение прав применяется к его доступу.`,
                    );
                  return success;
                }}
                onBlock={async () => {
                  if (
                    await model.update(account.id, {
                      blocked: !account.blocked,
                    })
                  )
                    setNotice(
                      account.blocked
                        ? `Вход для ${account.name} снова разрешён.`
                        : `Доступ для ${account.name} заблокирован; сеансы завершены.`,
                    );
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
            ))}
          </div>
          {!accounts.length && (
            <EmptyState
              title="Учётных записей нет"
              description="Создайте доступ для сотрудника, который уже есть в команде."
            />
          )}
        </>
      )}
      {model.error && !creating && !resetId && !revokeId && (
        <p className={styles.error} role="alert">
          {model.error}
        </p>
      )}
      {creating && (
        <CreateAccessForm
          data={data}
          accounts={accounts}
          pending={model.pending}
          error={model.error}
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            if (await model.create(values)) {
              setCreating(false);
              setNotice(
                "Доступ создан. Передайте сотруднику временный пароль: при первом входе его нужно сменить.",
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
          description={`Логин ${revokeAccount.login}. Все устройства этой учётной записи выйдут из склада. Для продолжения потребуется вход с текущим паролем.`}
          onClose={() => {
            if (!model.pending) setRevokeId(null);
          }}
        >
          <div className={styles.form}>
            <p className={styles.info}>
              Активных сеансов сейчас: {revokeAccount.activeSessions}. Пароль и
              роль останутся прежними.
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
    <article className={`glass-panel ${styles.card}`}>
      <div className={styles.cardHeader}>
        <div>
          <h3>
            {account.name}
            {own ? " · вы" : ""}
          </h3>
          <code>{account.login}</code>
        </div>
        <Badge tone={account.blocked ? "danger" : "success"}>
          {account.blocked
            ? "Вход заблокирован"
            : accessRoleLabels[account.role]}
        </Badge>
      </div>
      <div className={styles.badges}>
        {account.mustChangePassword && (
          <Badge tone="warning">Нужна смена временного пароля</Badge>
        )}
      </div>
      <div className={styles.facts}>
        <span>Создан: {accessDate(account.createdAt)}</span>
        <span>Последний вход: {accessDate(account.lastLoginAt)}</span>
        <span>Активных сеансов: {account.activeSessions}</span>
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
        <p className={styles.help}>
          Роль руководителя открывает управление складом и доступом. Смена роли
          завершает сеансы сотрудника.
        </p>
        {last && (
          <p className={styles.help}>
            Это последний активный руководитель. Его доступ нельзя заблокировать
            или понизить.
          </p>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !dirty || (last && role === "employee")}
          onClick={async () => {
            if (await onRole(role)) setTouched(false);
          }}
        >
          Сохранить роль
        </Button>
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant={account.blocked ? "secondary" : "ghost"}
            disabled={pending || (last && !account.blocked)}
            onClick={() => void onBlock()}
          >
            {account.blocked ? "Разрешить вход" : "Заблокировать вход"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || own}
            onClick={onReset}
          >
            <KeyRound size={14} />
            Сбросить пароль
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || account.activeSessions === 0}
            onClick={onRevoke}
          >
            Завершить сеансы
          </Button>
        </div>
        {own && (
          <p className={styles.help}>
            Свой пароль можно изменить в меню профиля слева: «Сменить пароль».
          </p>
        )}
        <p className={styles.help}>
          {account.blocked
            ? "Разрешение входа вернёт доступ с действующим паролем. Задания и резервы сохраняются."
            : "Блокировка запрещает вход и завершает все сеансы; её можно снять. Задания и резервы сохраняются."}
        </p>
      </div>
    </article>
  );
}
function CreateAccessForm({
  data,
  accounts,
  pending,
  error,
  onClose,
  onSave,
}: {
  data: WorkspaceDto;
  accounts: AuthAccountDto[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: AccessCreateValues) => Promise<void>;
}) {
  const form = useForm<AccessCreateValues>({
    resolver: zodResolver(accessCreateSchema),
    defaultValues: {
      employeeId: "",
      login: "",
      password: "",
      role: "employee",
    },
  });
  const available = data.employees.filter(
    (employee) =>
      !accounts.some((account) => account.employeeId === employee.id),
  );
  return (
    <Modal
      open
      title="Создать доступ сотруднику"
      description="Одна учётная запись на одного существующего сотрудника. Пароль будет временным."
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
            Сотрудник
            <Select
              {...form.register("employeeId")}
              aria-invalid={!!form.formState.errors.employeeId}
            >
              <option value="">Выберите сотрудника</option>
              {available.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </Select>
            {form.formState.errors.employeeId && (
              <span className={styles.error}>
                {form.formState.errors.employeeId.message}
              </span>
            )}
          </label>
          {!available.length && (
            <p className={styles.info}>
              У всех сотрудников уже есть доступ. Сначала добавьте сотрудника в
              команду.
            </p>
          )}
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
          Минимум 12 символов. При первом входе сотрудник задаст свой пароль.
          Передайте ему временный пароль лично: здесь он не сохраняется для
          повторного просмотра.
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
          <Button
            type="submit"
            disabled={pending || !available.length}
            aria-busy={pending}
          >
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
      description={`Логин ${account.login}. Сброс завершит все сеансы; перед доступом к складу владелец должен будет сменить пароль.`}
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
        <p className={styles.help}>
          От 12 до 128 символов. Передайте пароль сотруднику; повторный просмотр
          недоступен.
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
            Установить временный пароль
          </Button>
        </div>
      </form>
    </Modal>
  );
}
