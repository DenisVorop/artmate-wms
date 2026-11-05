"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createPalletLabelBatch } from "@/shared/api/generated/client";
import { ApiError } from "@/shared/api/api-error";
import { getAuthEpoch } from "@/shared/api/auth-memory";
import type { CreatePalletLabelBatchDto } from "@/shared/api/generated/model";
export function useCreateLabelBatch() {
  const client = useQueryClient();
  const request = useRef<CreatePalletLabelBatchDto | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  return {
    pending,
    error,
    unresolved,
    create: async (count: number) => {
      if (busy.current) return;
      const epoch = getAuthEpoch();
      busy.current = true;
      setPending(true);
      setError(null);
      request.current ??= { requestId: crypto.randomUUID(), count };
      try {
        const result = await createPalletLabelBatch(request.current);
        if (epoch !== getAuthEpoch()) return;
        request.current = null;
        setUnresolved(false);
        await client.invalidateQueries({ queryKey: ["pallet-label-batches"] });
        if (epoch !== getAuthEpoch()) return;
        return result;
      } catch (error) {
        if (epoch === getAuthEpoch()) {
          const rejected =
            error instanceof ApiError &&
            error.status !== null &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408;
          if (rejected) request.current = null;
          setUnresolved(!rejected);
          setError(
            error instanceof Error
              ? error.message
              : "Не удалось создать этикетки. Повторите действие.",
          );
        }
      } finally {
        busy.current = false;
        if (epoch === getAuthEpoch()) setPending(false);
      }
    },
  };
}
