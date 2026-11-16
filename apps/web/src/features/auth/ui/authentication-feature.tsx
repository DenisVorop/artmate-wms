"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Package } from "lucide-react";
import { useSession } from "@/entities/session";
import { Button, Input } from "@/shared/ui";
import {
  loginSchema,
  setupSchema,
  type LoginValues,
  type SetupValues,
} from "../lib/auth-form";
import { useAuthActions } from "../model/use-auth-actions";
import { PasswordChangeForm } from "./password-change-form";
import styles from "./auth.module.css";
function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.surface}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Package size={22} strokeWidth={1.7} aria-hidden="true" />
          <span>
            artmate <small>WMS</small>
          </span>
        </div>
        {children}
      </section>
    </main>
  );
}
function LoginForm() {
  const actions = useAuthActions();
  const id = useId();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: "", password: "" },
  });
  return (
    <>
      <h1>Вход в WMS</h1>
      <form
        noValidate
        className={styles.form}
        aria-busy={actions.pending}
        onSubmit={form.handleSubmit(async (values) => {
          if (!actions.pending) await actions.login(values);
        })}
      >
        <fieldset className={styles.fieldset} disabled={actions.pending}>
          <div className="field">
            <label htmlFor={`${id}-login`}>Логин</label>
            <Input
              id={`${id}-login`}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              {...form.register("login")}
              aria-invalid={!!form.formState.errors.login}
              aria-describedby={
                form.formState.errors.login ? `${id}-login-error` : undefined
              }
            />
            {form.formState.errors.login && (
              <span className={styles.error} id={`${id}-login-error`}>
                {form.formState.errors.login.message}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-password`}>Пароль</label>
            <Input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
              aria-invalid={!!form.formState.errors.password}
              aria-describedby={
                form.formState.errors.password
                  ? `${id}-password-error`
                  : undefined
              }
            />
            {form.formState.errors.password && (
              <span className={styles.error} id={`${id}-password-error`}>
                {form.formState.errors.password.message}
              </span>
            )}
          </div>
        </fieldset>
        {actions.error && (
          <p className={styles.error} role="alert">
            {actions.error}
          </p>
        )}
        <Button
          type="submit"
          disabled={actions.pending}
          aria-busy={actions.pending}
        >
          {actions.pending ? "Вход…" : "Войти"}
        </Button>
      </form>
      <p className={styles.help}>Забыли пароль? Обратитесь к руководителю.</p>
    </>
  );
}
function SetupForm() {
  const actions = useAuthActions();
  const id = useId();
  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { name: "", login: "", password: "", repeatPassword: "" },
  });
  return (
    <>
      <h1>Создайте учётную запись руководителя</h1>
      <form
        noValidate
        className={styles.form}
        aria-busy={actions.pending}
        onSubmit={form.handleSubmit(async (values) => {
          if (!actions.pending) await actions.setup(values);
        })}
      >
        <fieldset className={styles.fieldset} disabled={actions.pending}>
          {(
            [
              ["name", "Ваше имя", "text", "name"],
              ["login", "Логин", "text", "username"],
              ["password", "Пароль", "password", "new-password"],
              [
                "repeatPassword",
                "Повторите пароль",
                "password",
                "new-password",
              ],
            ] as const
          ).map(([field, label, type, autoComplete]) => (
            <div className="field" key={field}>
              <label htmlFor={`${id}-${field}`}>{label}</label>
              <Input
                id={`${id}-${field}`}
                type={type}
                autoComplete={autoComplete}
                autoCapitalize={field === "login" ? "off" : undefined}
                {...form.register(field)}
                aria-invalid={!!form.formState.errors[field]}
                aria-describedby={
                  form.formState.errors[field]
                    ? `${id}-${field}-error`
                    : undefined
                }
              />
              {form.formState.errors[field] && (
                <span className={styles.error} id={`${id}-${field}-error`}>
                  {form.formState.errors[field]?.message}
                </span>
              )}
            </div>
          ))}
        </fieldset>
        <p className={styles.help}>
          Пароль от 12 символов. Для логина используйте латиницу, цифры, точку,
          дефис или подчёркивание.
        </p>
        {actions.error && (
          <p className={styles.error} role="alert">
            {actions.error}
          </p>
        )}
        <Button
          type="submit"
          disabled={actions.pending}
          aria-busy={actions.pending}
        >
          Создать учётную запись
        </Button>
      </form>
    </>
  );
}
export function AuthenticationFeature() {
  const session = useSession();
  const actions = useAuthActions();
  const [passwordBusy, setPasswordBusy] = useState(false);
  return (
    <AuthFrame>
      {session.user?.mustChangePassword ? (
        <>
          <h1>Смените временный пароль</h1>
          <PasswordChangeForm required onBusyChange={setPasswordBusy} />
          <Button
            variant="ghost"
            disabled={actions.pending || passwordBusy}
            onClick={() => void actions.logout()}
            className={styles.signOut}
          >
            Выйти
          </Button>
          {actions.error && (
            <p className={styles.error} role="alert">
              {actions.error}
            </p>
          )}
        </>
      ) : session.needsSetup ? (
        <SetupForm />
      ) : (
        <LoginForm />
      )}
    </AuthFrame>
  );
}
