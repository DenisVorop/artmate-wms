"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Package, ShieldCheck } from "lucide-react";
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
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.surface}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Package size={27} strokeWidth={1.5} />
          <span>
            artmate<small>WAREHOUSE SYSTEM</small>
          </span>
        </div>
        {children}
      </section>
    </main>
  );
}
function LoginForm() {
  const actions = useAuthActions();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { login: "", password: "" },
  });
  return (
    <>
      <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
      <h1>Вход на склад</h1>
      <p className={styles.description}>
        Используйте личный логин и пароль. Смена и рабочие задания будут связаны
        с вашим сотрудником.
      </p>
      <form
        noValidate
        className={styles.form}
        aria-busy={actions.pending}
        onSubmit={form.handleSubmit(async (values) => {
          if (!actions.pending) await actions.login(values);
        })}
      >
        <fieldset className={styles.fieldset} disabled={actions.pending}>
          <label className="field">
            Логин
            <Input
              autoComplete="username"
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
            Пароль
            <Input
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
              aria-invalid={!!form.formState.errors.password}
            />
            {form.formState.errors.password && (
              <span className={styles.error}>
                {form.formState.errors.password.message}
              </span>
            )}
          </label>
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
          className={styles.primary}
        >
          Войти
        </Button>
      </form>
      <p className={styles.help} style={{ marginTop: 18 }}>
        Нет доступа или забыли пароль — обратитесь к руководителю склада.
      </p>
    </>
  );
}
function SetupForm() {
  const actions = useAuthActions();
  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { name: "", login: "", password: "", repeatPassword: "" },
  });
  return (
    <>
      <p className="eyebrow">ПЕРВЫЙ ЗАПУСК</p>
      <h1>Доступ руководителя</h1>
      <p className={styles.description}>
        Создайте свою учётную запись для управления складом и доступом
        сотрудников. Общего пароля по умолчанию нет.
      </p>
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
            <label className="field" key={field}>
              {label}
              <Input
                type={type}
                autoComplete={autoComplete}
                autoCapitalize={field === "login" ? "off" : undefined}
                {...form.register(field)}
                aria-invalid={!!form.formState.errors[field]}
              />
              {form.formState.errors[field] && (
                <span className={styles.error}>
                  {form.formState.errors[field]?.message}
                </span>
              )}
            </label>
          ))}
        </fieldset>
        <p className={styles.help}>
          Пароль — от 12 символов. Логин — латиница, цифры, точка, дефис или
          подчёркивание.
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
          <ShieldCheck size={16} />
          Создать доступ руководителя
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
          <p className="eyebrow">ЛИЧНЫЙ ДОСТУП</p>
          <h1>Задайте свой пароль</h1>
          <p className={styles.description}>
            {session.user.name}, временный пароль нужно заменить перед работой
            со складом.
          </p>
          <PasswordChangeForm required onBusyChange={setPasswordBusy} />
          <Button
            variant="ghost"
            disabled={actions.pending || passwordBusy}
            onClick={() => void actions.logout()}
            style={{ marginTop: 14 }}
          >
            Выйти из учётной записи
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
