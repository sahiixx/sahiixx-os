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
  return trpc.sahiixx.agentUpdate.useMutation();
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

export function usePing() {
  return trpc.ping.hello.useQuery({ text: "SAHIIXX" });
}
