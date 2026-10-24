"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/entities/session";
import { AuthBoundary } from "@/features/auth";
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 2000, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <AuthBoundary>{children}</AuthBoundary>
      </SessionProvider>
    </QueryClientProvider>
  );
}
