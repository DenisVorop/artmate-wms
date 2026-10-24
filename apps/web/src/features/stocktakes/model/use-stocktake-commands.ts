"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "@/shared/api/generated/client";
import type {
  StocktakeDto,
  CountStocktakeLocationDto,
} from "@/shared/api/generated/model";
import { stocktakeDocumentKey } from "@/entities/stocktake";
import { getAuthEpoch } from "@/shared/api/auth-memory";
import {
  stocktakeQueryKey,
  workspaceQueryKey,
  stockLedgerQueryKey,
  workforceQueryKey,
} from "@/shared/api/query-keys";
import { runStocktakeCommand } from "../lib/stocktake-command";
import { newestStocktake } from "../lib/stocktake-view";

export function useStocktakeCommands() {
  const client = useQueryClient();
  const busy = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, command: () => Promise<StocktakeDto>) => {
    if (busy.current) return null;
    busy.current = true;
    setPending(key);
    setError(null);
    const epoch = getAuthEpoch();
    try {
      const result = await runStocktakeCommand({
        isScopeCurrent: () => getAuthEpoch() === epoch,
        cancelReads: () =>
          client.cancelQueries({ queryKey: stocktakeQueryKey }),
        command,
        cache: (result) =>
          client.setQueryData(
            stocktakeDocumentKey(result.id),
            (cached: StocktakeDto | undefined) =>
              newestStocktake(result, cached),
          ),
        invalidate: async () => {
          await Promise.allSettled(
            [
              stocktakeQueryKey,
              workspaceQueryKey,
              stockLedgerQueryKey,
              workforceQueryKey,
            ].map((queryKey) => client.invalidateQueries({ queryKey })),
          );
        },
      });
      if (epoch !== getAuthEpoch())
        throw new Error("Сессия изменилась. Обновите вход.");
      return newestStocktake(
        result,
        client.getQueryData<StocktakeDto>(stocktakeDocumentKey(result.id)),
      );
    } catch (error) {
      if (epoch === getAuthEpoch())
        setError(
          error instanceof Error
            ? error.message
            : "Не удалось изменить документ. Повторите действие.",
        );
      return null;
    } finally {
      busy.current = false;
      if (epoch === getAuthEpoch()) setPending(null);
    }
  };
  const command = (doc: StocktakeDto) => ({
    requestId: crypto.randomUUID(),
    expectedRevision: doc.revision,
  });
  return {
    pending,
    error,
    clearError: () => setError(null),
    create: (locationIds: string[]) =>
      run("create", () =>
        api.createStocktake({ requestId: crypto.randomUUID(), locationIds }),
      ),
    claim: (doc: StocktakeDto) =>
      run("claim", () => api.claimStocktake(doc.id, command(doc))),
    count: (
      doc: StocktakeDto,
      locationId: string,
      values: Omit<CountStocktakeLocationDto, "requestId" | "expectedRevision">,
      expectedRevision: number,
    ) =>
      run(`count:${locationId}`, () =>
        api.countStocktakeLocation(doc.id, locationId, {
          ...command(doc),
          ...values,
          expectedRevision,
        }),
      ),
    refresh: (doc: StocktakeDto, locationId: string) =>
      run(`refresh:${locationId}`, () =>
        api.refreshStocktakeLocation(doc.id, locationId, command(doc)),
      ),
    submit: (doc: StocktakeDto) =>
      run("submit", () => api.submitStocktake(doc.id, command(doc))),
    approve: (doc: StocktakeDto, reason: string) =>
      run("approve", () =>
        api.approveStocktake(doc.id, { ...command(doc), reason }),
      ),
    cancel: (doc: StocktakeDto, reason: string) =>
      run("cancel", () =>
        api.cancelStocktake(doc.id, { ...command(doc), reason }),
      ),
  };
}
