"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthSession } from "@/shared/api/generated/client";
import type { AuthSessionDto } from "@/shared/api/generated/model";
import {
  advanceAuthEpoch,
  setCsrfToken,
  setAuthIdentityScope,
  subscribeSessionInvalidation,
} from "@/shared/api/auth-memory";
import { ApiError } from "@/shared/api/api-error";
import {
  publicSession,
  sessionScope,
  synchronizeReplayScope,
} from "../lib/session-state";
type RefreshOptions = { isolate?: boolean };
type ContextValue = {
  data: AuthSessionDto | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: (options?: RefreshOptions) => Promise<AuthSessionDto | undefined>;
  acceptSession: (response: AuthSessionDto, force?: boolean) => Promise<void>;
};
const SessionContext = createContext<ContextValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [data, setData] = useState<AuthSessionDto>();
  const [isPending, setPending] = useState(true);
  const [isError, setError] = useState(false);
  const current = useRef<AuthSessionDto | undefined>(undefined);
  const scopeRef = useRef<string | undefined>(undefined);
  const serial = useRef(0);
  const inFlight = useRef<Promise<AuthSessionDto | undefined> | null>(null);
  const isolate = useCallback(async () => {
    advanceAuthEpoch();
    setData(undefined);
    setPending(true);
    await client.cancelQueries().catch(() => undefined);
    client.clear();
    try {
      synchronizeReplayScope(window.sessionStorage, "signed-out", true);
    } catch {
      /* Writes are rejected safely by replay transport when storage is unavailable. */
    }
  }, [client]);
  const apply = useCallback(
    async (response: AuthSessionDto, force = false, readSerial?: number) => {
      const sequence = readSerial ?? ++serial.current;
      if (sequence !== serial.current) return;
      const nextScope = sessionScope(response.user);
      let persistedChange = false;
      try {
        persistedChange =
          window.sessionStorage.getItem("artmate-wms:auth-scope:v1") !==
          nextScope;
      } catch {
        /* No storage access means warehouse writes already fail closed. */
      }
      const changed =
        scopeRef.current !== undefined && scopeRef.current !== nextScope;
      if (force || changed || persistedChange) {
        await isolate();
        if (sequence !== serial.current) return;
      }
      try {
        synchronizeReplayScope(
          window.sessionStorage,
          nextScope,
          force || changed,
        );
      } catch {
        /* Do not persist any credential; read-only login remains available. */
      }
      scopeRef.current = nextScope;
      setAuthIdentityScope(nextScope);
      setCsrfToken(response.csrfToken);
      const safe = publicSession(response);
      current.current = safe;
      setData(safe);
      setError(false);
      setPending(false);
    },
    [isolate],
  );
  const acceptSession = useCallback(
    (response: AuthSessionDto, force = true) => apply(response, force),
    [apply],
  );
  const refetch = useCallback(
    (options: RefreshOptions = {}) => {
      if (inFlight.current && !options.isolate) return inFlight.current;
      const sequence = ++serial.current;
      const promise = (async () => {
        try {
          if (options.isolate) await isolate();
          const response = await getAuthSession();
          if (sequence !== serial.current) return undefined;
          await apply(response, false, sequence);
          if (sequence !== serial.current) return undefined;
          return publicSession(response);
        } catch (error) {
          if (sequence !== serial.current) return undefined;
          if (error instanceof ApiError && error.status === 401) {
            const signedOut: AuthSessionDto = {
              needsSetup: false,
              user: null,
              csrfToken: null,
              expiresAt: null,
            };
            await apply(signedOut, true, sequence);
            return signedOut;
          }
          setError(true);
          setPending(false);
          return undefined;
        }
      })();
      inFlight.current = promise;
      void promise.finally(() => {
        if (inFlight.current === promise) inFlight.current = null;
      });
      return promise;
    },
    [apply, isolate],
  );
  useEffect(() => {
    void refetch();
    const interval = setInterval(() => void refetch(), 5000);
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeSessionInvalidation(() => {
      void refetch({ isolate: true });
    });
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [refetch]);
  const value = useMemo(
    () => ({ data, isPending, isError, refetch, acceptSession }),
    [data, isPending, isError, refetch, acceptSession],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is required");
  const user = context.data?.user ?? null;
  return {
    ...context,
    user,
    needsSetup: context.data?.needsSetup ?? false,
    role: user?.role ?? null,
    isManager: user?.role === "manager",
  };
}
