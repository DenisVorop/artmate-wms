"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/entities/session";
import { updateWorkAutomationSettings } from "@/shared/api/generated/client";
import { getAuthEpoch, getAuthIdentityScope } from "@/shared/api/auth-memory";
import { workspaceQueryKey } from "@/shared/api/query-keys";

export function useWorkAutomationSettings() {
  const client = useQueryClient(),
    session = useSession();
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
  async function save(enabled: boolean) {
    if (lock.current || !session.isManager) return false;
    const epoch = getAuthEpoch(),
      scope = getAuthIdentityScope();
    const current = () =>
      mounted.current &&
      epoch === getAuthEpoch() &&
      scope === getAuthIdentityScope();
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await updateWorkAutomationSettings({
        requestId: crypto.randomUUID(),
        enabled,
      });
      if (!current()) return false;
      // A replay acknowledgement can describe an old setting. Refresh the
      // authoritative status rather than replacing it with that old response.
      await client.invalidateQueries({
        queryKey: ["work-automation", scope, epoch],
      });
      if (!current()) return false;
      void client.invalidateQueries({ queryKey: workspaceQueryKey });
      return true;
    } catch (failure) {
      if (current())
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось сохранить настройку.",
        );
      return false;
    } finally {
      lock.current = false;
      if (current()) setPending(false);
    }
  }
  return { save, pending, error };
}
