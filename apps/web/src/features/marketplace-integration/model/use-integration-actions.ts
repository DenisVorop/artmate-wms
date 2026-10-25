"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/shared/api/generated/client";
import type {
  ConnectMarketplaceDto,
  MapMarketplaceProductDto,
  ToggleMarketplaceDto,
} from "@/shared/api/generated/model";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";

export function useIntegrationActions() {
  const client = useQueryClient();
  const lock = useRef(false),
    mounted = useRef(true);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(command: () => Promise<unknown>, message: string) {
    if (lock.current) return false;
    const epoch = getAuthEpoch(),
      scope = getAuthIdentityScope();
    const current = () =>
      mounted.current &&
      getAuthEpoch() === epoch &&
      getAuthIdentityScope() === scope;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await command();
      if (!current()) return false;
      await client.invalidateQueries({
        queryKey: ["marketplaces", scope, epoch],
      });
      return current();
    } catch {
      if (current()) setError(message);
      return false;
    } finally {
      lock.current = false;
      if (current()) setPending(false);
    }
  }
  return {
    pending,
    error,
    clearError: () => setError(null),
    connect: (values: Omit<ConnectMarketplaceDto, "requestId">) =>
      run(
        () =>
          api.connectMarketplace({ ...values, requestId: crypto.randomUUID() }),
        "Не удалось сохранить подключение. Проверьте обязательные поля и соединение со складом.",
      ),
    toggle: (provider: ToggleMarketplaceDto["provider"], enabled: boolean) =>
      run(
        () =>
          api.toggleMarketplace({
            requestId: crypto.randomUUID(),
            provider,
            enabled,
          }),
        "Не удалось изменить подключение.",
      ),
    sync: (provider: ToggleMarketplaceDto["provider"]) =>
      run(
        () => api.syncMarketplace({ requestId: crypto.randomUUID(), provider }),
        "Не удалось завершить загрузку. Проверьте статус подключения и повторите попытку.",
      ),
    map: (values: Omit<MapMarketplaceProductDto, "requestId">) =>
      run(
        () =>
          api.mapMarketplaceProduct({
            ...values,
            requestId: crypto.randomUUID(),
          }),
        "Не удалось сохранить соответствие. Обновите каталог и повторите попытку.",
      ),
  };
}
