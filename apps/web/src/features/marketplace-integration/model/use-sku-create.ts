"use client";
import { useEffect, useRef, useState } from "react";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { submitSkuCreate } from "../lib/sku-create-command";
import { skuCreatePayload, type SkuCreateValues } from "../lib/sku-create-form";

export function useSkuCreate() {
  const commands = useWarehouseCommands();
  const mounted = useRef(true),
    lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function create(values: SkuCreateValues) {
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
      return await submitSkuCreate(
        () =>
          commands.createSku({
            ...skuCreatePayload(values),
            requestId: crypto.randomUUID(),
          }),
        current,
      );
    } catch (failure) {
      if (current())
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось создать тематику",
        );
      return false;
    } finally {
      lock.current = false;
      if (current()) setPending(false);
    }
  }
  return { create, pending, error };
}
