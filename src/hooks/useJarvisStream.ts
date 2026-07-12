// Client hook for the Jarvis realtime SSE stream. POSTs the user message to
// /api/jarvis/stream with the JWT bearer, then reads the SSE response body and
// dispatches events to callbacks. stop() aborts the fetch (interruptible).
// approve(nonce) releases a pending service_control op after the user clicks.
import { useCallback, useRef, useState } from "react";
import { getToken } from "@/lib/auth";

export interface JarvisStreamHandlers {
  onToken?: (token: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string) => void;
  onAudio?: (seq: number, mime: string, base64: string) => void;
  onScreen?: (data: { seq: number; mime: string; base64: string; width: number; height: number }) => void;
  onApprovals?: (approvals: Array<JarvisApproval>) => void;
  onTurnEnd?: (content: string) => void;
  onError?: (message: string) => void;
  // Fires once when the SSE stream closes (clean turn_end, server drop, network
  // error, or user STOP). `aborted` is true for a user-initiated stop. Use to
  // finalize any turn that never received a turn_end so the UI can't hang.
  onStreamEnd?: (aborted: boolean) => void;
}

export interface JarvisApproval {
  nonce: string;
  kind: "service" | "os" | "shell";
  label: string;
}

export function useJarvisStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (message: string, sessionId: string, h: JarvisStreamHandlers, opts?: { voiceId?: string }) => {
    const token = getToken();
    if (!token) {
      h.onError?.("Not authenticated.");
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setIsStreaming(true);
    try {
      const res = await fetch("/api/jarvis/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, sessionId, voiceId: opts?.voiceId }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => res.statusText);
        h.onError?.(`Stream failed (HTTP ${res.status}): ${detail}`);
        return;
      }
      await consumeStream(res.body, h);
    } catch (e: any) {
      if (e?.name === "AbortError") return; // graceful interrupt
      h.onError?.(e?.message ?? String(e));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      h.onStreamEnd?.(ac.signal.aborted);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const approve = useCallback(async (nonce: string): Promise<{ ok: boolean; output: string; kind?: string; label?: string }> => {
    const token = getToken();
    if (!token) return { ok: false, output: "Not authenticated." };
    const res = await fetch("/api/jarvis/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nonce }),
    });
    return (await res.json().catch(() => ({ ok: false, output: "Invalid response" }))) as {
      ok: boolean; output: string; kind?: string; label?: string;
    };
  }, []);

  return { start, stop, approve, isStreaming };
}

/** Decode the SSE response body and dispatch events to the handlers. */
async function consumeStream(body: ReadableStream<Uint8Array>, h: JarvisStreamHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        dispatchFrame(frame, h);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame(frame: string, h: JarvisStreamHandlers) {
  let event = "message";
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return;
  const data = dataLines.join("\n");

  switch (event) {
    case "token":
      h.onToken?.(data);
      break;
    case "tool_call": {
      try { const j = JSON.parse(data); h.onToolCall?.(j.name, j.args); } catch {}
      break;
    }
    case "tool_result": {
      try { const j = JSON.parse(data); h.onToolResult?.(j.name, j.result); } catch {}
      break;
    }
    case "audio": {
      try { const j = JSON.parse(data); h.onAudio?.(j.seq, j.mime, j.base64); } catch {}
      break;
    }
    case "screen": {
      try { const j = JSON.parse(data); h.onScreen?.(j); } catch {}
      break;
    }
    case "approvals": {
      try { const j = JSON.parse(data); h.onApprovals?.(j); } catch {}
      break;
    }
    case "turn_end": {
      try { const j = JSON.parse(data); h.onTurnEnd?.(j.content); } catch { h.onTurnEnd?.(data); }
      break;
    }
    case "ping":
      break;
    case "error": {
      try { const j = JSON.parse(data); h.onError?.(j.message); } catch { h.onError?.(data); }
      break;
    }
    default:
      break;
  }
}