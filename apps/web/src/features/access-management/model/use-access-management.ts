"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthIdentityScope } from "@/shared/api/auth-memory";
import { sessionScope } from "@/entities/session";
import { useSession } from "@/entities/session";
import * as api from "@/shared/api/generated/client";
import type {
  AuthAccountsDto,
  UpdateAuthAccountDto,
} from "@/shared/api/generated/model";
import type {
  AccessCreateValues,
  ResetPasswordValues,
} from "../lib/access-form";
const accountsKey = ["auth-accounts"] as const;
export function useAccessManagement() {
  const session = useSession();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: accountsKey,
    queryFn: () => api.getAuthAccounts(),
    enabled: session.isManager && !session.user?.mustChangePassword,
    refetchInterval: 5000,
    retry: 1,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (command: () => Promise<AuthAccountsDto>, id?: string) => {
    if (pending) return false;
    setPending(true);
    setError(null);
    const actorId = session.user?.id;
    try {
      const result = await command();
      const fresh = await session.refetch({ isolate: id === actorId });
      if (
        fresh?.user &&
        actorId &&
        fresh.user.id === actorId &&
        fresh.user.role === "manager" &&
        getAuthIdentityScope() === sessionScope(fresh.user) &&
        !fresh.user.mustChangePassword
      )
        client.setQueryData(accountsKey, result);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить доступ");
      return false;
    } finally {
      setPending(false);
    }
  };
  return {
    query,
    pending,
    error,
    clearError: () => setError(null),
    create: (values: AccessCreateValues) =>
      run(() => api.createAuthAccount(values)),
    update: (id: string, values: UpdateAuthAccountDto) =>
      run(() => api.updateAuthAccount(id, values), id),
    reset: (id: string, values: ResetPasswordValues) =>
      run(() => api.resetAuthPassword(id, values), id),
    revoke: (id: string) => run(() => api.revokeAuthSessions(id), id),
  };
}
