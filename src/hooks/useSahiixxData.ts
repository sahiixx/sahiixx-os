import { trpc } from "@/providers/trpc";

export function useAgentList() {
  return trpc.sahiixx.agentList.useQuery(undefined, {
    refetchInterval: 5000,
    placeholderData: [],
  });
}

export function useAgentCreate() {
  return trpc.sahiixx.agentCreate.useMutation();
}

export function useAgentUpdate() {
  const utils = trpc.useUtils();
  return trpc.sahiixx.agentUpdate.useMutation({
    onSuccess: () => { utils.sahiixx.agentList.invalidate(); },
  });
}

export function useAgentDelete() {
  return trpc.sahiixx.agentDelete.useMutation();
}

export function useMcpList() {
  return trpc.sahiixx.mcpList.useQuery(undefined, {
    refetchInterval: 10000,
    placeholderData: [],
  });
}

export function useDealList() {
  return trpc.sahiixx.dealList.useQuery(undefined, {
    placeholderData: [],
  });
}

export function useDealCreate() {
  return trpc.sahiixx.dealCreate.useMutation();
}

export function useContactList() {
  return trpc.sahiixx.contactList.useQuery(undefined, {
    placeholderData: [],
  });
}

export function useContactSearch(query: string) {
  return trpc.sahiixx.contactSearch.useQuery(
    { query },
    { enabled: query.length > 0, placeholderData: [] }
  );
}

export function useCampaignList() {
  return trpc.sahiixx.campaignList.useQuery(undefined, {
    placeholderData: [],
  });
}

export function useVideoList() {
  return trpc.sahiixx.videoList.useQuery(undefined, {
    placeholderData: [],
  });
}

export function useSignalList() {
  return trpc.sahiixx.signalList.useQuery(undefined, {
    refetchInterval: 3000,
    placeholderData: [],
  });
}

export function useSignalCreate() {
  return trpc.sahiixx.signalCreate.useMutation();
}

export function useDeployedList() {
  return trpc.sahiixx.deployedList.useQuery(undefined, {
    placeholderData: [],
  });
}

export function useDeployedCreate() {
  return trpc.sahiixx.deployedCreate.useMutation();
}

// ── new creates + ops hooks ────────────────────────────────────────────────
export function useDbStatus() {
  return trpc.sahiixx.dbStatus.useQuery(undefined, { staleTime: 30_000 });
}

export function useContactCreate() {
  return trpc.sahiixx.contactCreate.useMutation();
}

export function useCampaignCreate() {
  return trpc.sahiixx.campaignCreate.useMutation();
}

export function useVideoCreate() {
  return trpc.sahiixx.videoCreate.useMutation();
}

export function useOpsMetrics() {
  return trpc.sahiixx.opsMetrics.useQuery(undefined, { refetchInterval: 5000 });
}
export function useOpsPipeline() {
  return trpc.sahiixx.opsPipeline.useQuery(undefined, { placeholderData: [] });
}
export function useOpsModels() {
  return trpc.sahiixx.opsModels.useQuery(undefined, { placeholderData: [] });
}
export function useModuleCounts() {
  return trpc.sahiixx.moduleCounts.useQuery(undefined, { refetchInterval: 8000 });
}

// ── Postiz (SARA real social scheduling) ───────────────────────────────────
export function usePostizStatus() {
  return trpc.sahiixx.postizStatus.useQuery(undefined, { staleTime: 60_000, placeholderData: { available: false, channels: 0, error: null } });
}
export function usePostizIntegrations() {
  return trpc.sahiixx.postizIntegrations.useQuery(undefined, { staleTime: 60_000, placeholderData: { available: false, integrations: [], error: null } });
}
export function usePostizSchedule() {
  return trpc.sahiixx.postizSchedule.useMutation();
}

export function usePing() {
  return trpc.ping.hello.useQuery({ text: "SAHIIXX" });
}

export function useLogin() {
  return trpc.auth.login.useMutation();
}

export function useRegister() {
  return trpc.auth.register.useMutation();
}

export function useRefresh() {
  return trpc.auth.refresh.useMutation();
}

export function useMe(opts?: { enabled?: boolean }) {
  return trpc.auth.me.useQuery(undefined, opts);
}
