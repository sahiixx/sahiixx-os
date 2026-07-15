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

export function useWorkersAiProbe() {
  return trpc.system.workersAiProbe.useMutation();
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

export function useEstateConfig() {
  return trpc.nexus.estateConfig.useQuery(undefined, { staleTime: 30_000 });
}

export function useEstateHealth() {
  return trpc.nexus.estateHealth.useQuery(undefined, {
    refetchInterval: 20_000,
  });
}

export function useEstateLeads() {
  return trpc.nexus.estateLeads.useQuery(undefined, {
    refetchInterval: 15_000,
  });
}

export function useImportLeadAsDeal() {
  const utils = trpc.useUtils();
  return trpc.nexus.importLeadAsDeal.useMutation({
    onSuccess: () => {
      utils.sahiixx.dealList.invalidate();
      utils.nexus.estateLeads.invalidate();
    },
  });
}
