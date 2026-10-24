"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { beginAuthIntent, getAuthIntent } from "@/shared/api/auth-memory";
import { useSession } from "@/entities/session";
import {
  login,
  setupAuth,
  logout,
  changePassword,
} from "@/shared/api/generated/client";
import type {
  LoginValues,
  SetupValues,
  PasswordChangeValues,
} from "../lib/auth-form";
export function useAuthActions() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    command: () => ReturnType<typeof login>,
    navigate = false,
  ) => {
    const intent = beginAuthIntent();
    setPending(true);
    setError(null);
    try {
      const response = await command();
      if (intent !== getAuthIntent()) return false;
      await session.acceptSession(response);
      if (navigate && response.user)
        router.replace(
          response.user.role === "manager"
            ? pathname === "/login"
              ? "/"
              : pathname
            : "/assembly",
        );
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
      return false;
    } finally {
      setPending(false);
    }
  };
  return {
    pending,
    error,
    clearError: () => setError(null),
    login: (values: LoginValues) => run(() => login(values), true),
    setup: ({ repeatPassword: _, ...values }: SetupValues) =>
      run(() => setupAuth(values), true),
    logout: () => run(() => logout()),
    change: ({ repeatPassword: _, ...values }: PasswordChangeValues) =>
      run(() => changePassword(values)),
  };
}
