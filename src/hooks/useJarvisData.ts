// Thin tRPC wrappers for the Jarvis session router. v1 reads the in-memory
// session map on the server. sessionCreate returns a fresh id the client
// passes to the SSE stream + reuse across turns.
import { trpc } from "@/providers/trpc";

export function useSessionList() {
  return trpc.jarvis.sessionList.useQuery(undefined, { refetchInterval: 10000, placeholderData: [] });
}

export function useSessionCreate() {
  return trpc.jarvis.sessionCreate.useMutation();
}

export function useSessionMessages(id: string | null) {
  return trpc.jarvis.sessionMessages.useQuery({ id: id ?? "" }, { enabled: !!id, placeholderData: [] });
}

export function useSetAllowShell() {
  return trpc.jarvis.setAllowShell.useMutation();
}

export function useSetAllowOsControl() {
  return trpc.jarvis.setAllowOsControl.useMutation();
}

export function useSetAllowRawShell() {
  return trpc.jarvis.setAllowRawShell.useMutation();
}

export function useSetSituational() {
  return trpc.jarvis.setSituational.useMutation();
}

// ElevenLabs voice library for the Jarvis voice-picker. available=false (or
// no key) → client hides the picker and uses the env default / browser TTS.
export function useJarvisVoices() {
  return trpc.jarvis.voices.useQuery(undefined, { staleTime: 5 * 60_000, placeholderData: { available: false, voices: [] } });
}