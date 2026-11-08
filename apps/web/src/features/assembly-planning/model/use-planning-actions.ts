"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SetMarketplaceResolutionDto } from "@/shared/api/generated/model";
import * as api from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { workspaceQueryKey } from "@/shared/api/query-keys";
import type { PlanningValues } from "../lib/planning-form";

export function usePlanningActions() {
  const client = useQueryClient(),
    lock = useRef(false),
    mounted = useRef(true);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run<T>(
    command: () => Promise<T>,
    message: string,
  ): Promise<T | undefined> {
    if (lock.current) return undefined;
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
      const result = await command();
      if (!current()) return undefined;
      await client.invalidateQueries({
        queryKey: ["marketplaces", scope, epoch],
      });
      if (!current()) return undefined;
      void client.invalidateQueries({ queryKey: ["forecast", scope, epoch] });
      void client.invalidateQueries({ queryKey: workspaceQueryKey });
      return result;
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : message);
      return undefined;
    } finally {
      lock.current = false;
      if (current()) setPending(false);
    }
  }
  return {
    pending,
    error,
    save: (values: PlanningValues) =>
      run(
        () =>
          api.updateMarketplaceSettings({
            requestId: crypto.randomUUID(),
            ...values,
          }),
        "Не удалось сохранить настройки плана.",
      ),
    transit: (skuId: string, inTransitUnits: number) =>
      run(
        () =>
          api.setMarketplaceTransit({
            requestId: crypto.randomUUID(),
            skuId,
            inTransitUnits,
          }),
        "Не удалось подтвердить товар в пути.",
      ),
    resolution: (values: Omit<SetMarketplaceResolutionDto, "requestId">) =>
      run(
        () =>
          api.setMarketplaceResolution({
            requestId: crypto.randomUUID(),
            ...values,
          }),
        "Не удалось сохранить уточнение плана.",
      ),
    create: (
      skuId: string,
      proposalHash: string,
      purpose: "urgent" | "backlog" = "urgent",
    ) =>
      run(
        () =>
          api.createMarketplaceTask({
            requestId: crypto.randomUUID(),
            skuId,
            proposalHash,
            purpose,
          }),
        "Не удалось создать задание. Обновите расчёт.",
      ),
  };
}
