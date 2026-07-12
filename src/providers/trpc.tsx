import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import superjson from "superjson";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { AppRouter } from "../../api/boot";
import { getToken, clearSession } from "@/lib/auth";

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return "http://localhost:3000";
}

// A tRPC error carries its server-side code on `.data.code` (UNAUTHORIZED,
// FORBIDDEN, …). Guard loosely so unknown shapes don't crash the handler.
function isUnauthorized(e: unknown): boolean {
  return (e as { data?: { code?: string } })?.data?.code === "UNAUTHORIZED";
}

// On a 401 anywhere in the app (expired/invalid JWT), drop the stale token and
// bounce to /login. No-op when already on /login (avoids a redirect loop) or
// outside the browser. This is the one place token-expiry is handled globally —
// otherwise every protected mutation would just surface a raw error to the page.
function handle401() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  clearSession();
  window.location.assign("/login");
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (e) => { if (isUnauthorized(e)) handle401(); } }),
        mutationCache: new MutationCache({ onError: (e) => { if (isUnauthorized(e)) handle401(); } }),
        defaultOptions: {
          queries: {
            // Keep the default 3 retries for ordinary failures, but never retry a
            // 401 — handle401 clears the token and redirects instead.
            retry: (failureCount, e) => (isUnauthorized(e) ? false : failureCount < 3),
          },
          mutations: { retry: false },
        },
      })
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers() {
            const token = getToken();
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}