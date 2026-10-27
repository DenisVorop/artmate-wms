"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import {
  historyPeriod,
  policyCommand,
  type ForecastPolicyValues,
  type FinanceValues,
} from "../lib/forecast-form";
export function useForecastActions() {
  const client = useQueryClient(),
    lock = useRef(false),
    mounted = useRef(true);
  const [pending, setPending] = useState<
      "history" | "finance" | "policy" | null
    >(null),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(
    kind: NonNullable<typeof pending>,
    command: () => Promise<unknown>,
    message: string,
    success: string,
  ) {
    if (lock.current) return false;
    const epoch = getAuthEpoch(),
      scope = getAuthIdentityScope(),
      current = () =>
        mounted.current &&
        getAuthEpoch() === epoch &&
        getAuthIdentityScope() === scope;
    lock.current = true;
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      await command();
      if (!current()) return false;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["forecast", scope, epoch] }),
        client.invalidateQueries({
          queryKey: ["forecast-history", scope, epoch],
        }),
        client.invalidateQueries({ queryKey: ["marketplaces", scope, epoch] }),
      ]);
      if (!current()) return false;
      setNotice(success);
      return true;
    } catch {
      if (current()) setError(message);
      return false;
    } finally {
      lock.current = false;
      if (current()) setPending(null);
    }
  }
  return {
    pending,
    error,
    notice,
    start: (
      provider: "ozon" | "wildberries",
      period?: { from: string; to: string },
    ) =>
      run(
        "history",
        () =>
          api.startForecastHistory({
            requestId: crypto.randomUUID(),
            provider,
            ...(period ?? historyPeriod()),
          }),
        "Не удалось запустить загрузку. Проверьте подключение маркетплейса.",
        "История поставлена в очередь. Можно продолжать работать.",
      ),
    finance: (values: FinanceValues) =>
      run(
        "finance",
        () =>
          api.connectForecastFinance({
            requestId: crypto.randomUUID(),
            ...values,
          }),
        "Не удалось подтвердить ключ. Он должен принадлежать тому же магазину WB и иметь доступ к финансовой истории.",
        "Ключ сохранён. История WB будет загружаться постепенно.",
      ),
    policy: (skuId: string, values: ForecastPolicyValues) =>
      run(
        "policy",
        () =>
          api.updateForecastPolicy(
            policyCommand(skuId, values, crypto.randomUUID()),
          ),
        "Не удалось сохранить настройки. Повторите попытку.",
        "Настройки сохранены. План уточняется.",
      ),
  };
}
