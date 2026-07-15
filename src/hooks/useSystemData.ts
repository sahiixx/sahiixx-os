import { trpc } from "@/providers/trpc";

export function useSystemStatus() {
  return trpc.system.status.useQuery(undefined, {
    refetchInterval: 15_000,
  });
}

export function useSystemActivity(limit = 50) {
  return trpc.system.activityList.useQuery(
    { limit },
    { refetchInterval: 10_000 },
  );
}

export function useSystemMetrics() {
  return trpc.system.metrics.useQuery(undefined, {
    refetchInterval: 10_000,
  });
}

export function useSystemHeartbeat() {
  return trpc.system.heartbeat.useMutation();
}

export function useAuthListUsers(enabled = true) {
  return trpc.auth.listUsers.useQuery(undefined, {
    enabled,
    staleTime: 30_000,
  });
}

export function useAuthBootstrapAdmin() {
  return trpc.auth.bootstrapAdmin.useMutation();
}

export function useAuthChangePassword() {
  return trpc.auth.changePassword.useMutation();
}
