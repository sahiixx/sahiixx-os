import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Square, ShieldAlert, Loader2, CheckCircle2, XCircle,
  Eye, Radio, AudioLines, Power, Zap, Terminal, Monitor, Cpu, Activity,
  FolderTree, FileText, Keyboard, MousePointer2, Clipboard, Volume2,
  Trash2, Server, Database, AppWindow, Settings2, X, Bell, Radar,
} from "lucide-react";
import { useJarvisStream, type JarvisApproval } from "@/hooks/useJarvisStream";
import { useSessionCreate, useSetAllowShell, useSetAllowOsControl, useSetAllowRawShell, useSetSituational, useSessionList, useJarvisVoices } from "@/hooks/useJarvisData";
import { trpc } from "@/providers/trpc";
import { useSignalList } from "@/hooks/useSahiixxData";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ToolStep { name: string; args: Record<string, unknown>; result?: string }
interface ScreenShot { seq: number; mime: string; base64: string; width: number; height: number }
interface Turn {
  id: string;
  user: string;
  assistant: string;
  tools: ToolStep[];
  screens: ScreenShot[];
  done: boolean;
  error?: string;
  ts: number;
}
const SESSION_KEY = "jarvis_session_id";

// ── Tool icon mapping ──────────────────────────────────────────────────────────
const TOOL_ICON: Record<string, typeof Mic> = {
  screen_capture: Monitor, sys_status: Cpu, process_list: Activity, window_list: AppWindow,
  file_list: FolderTree, file_read: FileText, app_open: Power, app_close: X,
  type_text: Keyboard, key_send: Keyboard, mouse_action: MousePointer2, clipboard: Clipboard,
  volume_set: Volume2, file_delete: Trash2, file_move: FolderTree, process_kill: X,
  power_action: Power, system_setting: Settings2, win_script: Terminal,
  opa_dispatch: Radio, nexus_query: Database, service_control: Server,
};

export default function Jarvis() {
  const { start, stop, approve, isStreaming } = useJarvisStream();
  const createSession = useSessionCreate();
  const setAllowShellMut = useSetAllowShell();
  const setAllowOsControlMut = useSetAllowOsControl();
  const setAllowRawShellMut = useSetAllowRawShell();
  const setSituationalMut = useSetSituational();
  const sessionList = useSessionList();
  const utils = trpc.useUtils();

  const [sessionId, setSessionId] = useState<string>(() => localStorage.getItem(SESSION_KEY) ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [allowShell, setAllowShell] = useState(false);
  const [allowOsControl, setAllowOsControl] = useState(false);
  const [allowRawShell, setAllowRawShell] = useState(false);
  const [rawShellConfirm, setRawShellConfirm] = useState(false);
  const [situational, setSituational] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [proactive, setProactive] = useState(false);
  const [wakeWord, setWakeWord] = useState(false);
  const [approvals, setApprovals] = useState<JarvisApproval[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string>(() => localStorage.getItem("jarvis_voice_id") ?? "");
  const voicesQuery = useJarvisVoices();
  const signalList = useSignalList();

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioPlayingRef = useRef(false);
  const turnRef = useRef<Turn | null>(null);
  // The turn whose audio is allowed to play right now. On barge-in a new turn
  // takes this over so stale TTS/audio from the interrupted turn gets dropped.
  const activeTurnIdRef = useRef<string | null>(null);
  const audioPlayedRef = useRef(false);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const handsFreeRef = useRef(false);
  const voiceIdRef = useRef(voiceId);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => { voiceIdRef.current = voiceId; localStorage.setItem("jarvis_voice_id", voiceId); }, [voiceId]);
  // Refs so the hands-free re-arm timer + startMic guard read LIVE values, not
  // the stale render-closure values captured when beginTurn was called (without
  // these, hands-free never re-arms — the guard sees the old isStreaming/listening).
  const isStreamingRef = useRef(false);
  const listeningRef = useRef(false);
  const audioUrlRef = useRef<string | null>(null);
  const micTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wake-word ambient listener (idle-only, no echo: the mic is closed during
  // turns). wakeRecRef holds the continuous recognizer; wakeRestartRef re-arms
  // after browsers auto-stop continuous recognition on silence.
  const wakeRecRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeWordRef = useRef(false);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  useEffect(() => { wakeWordRef.current = wakeWord; }, [wakeWord]);
  // Tear down recognition, speech, blob URLs, and pending timers on unmount so
  // the mic indicator, an in-flight utterance, or a queued re-arm don't outlive the page.
  useEffect(() => () => {
    recognitionRef.current?.stop();
    wakeRecRef.current?.stop();
    if (wakeRestartRef.current) clearTimeout(wakeRestartRef.current);
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    if (micTimerRef.current) clearTimeout(micTimerRef.current);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const supported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }, []);

  // ── Session bootstrap ──────────────────────────────────────────────────────
  // If the backend is down or the JWT is rejected, surface the error with a
  // RETRY instead of hanging on "…" forever (beginTurn bails without a session).
  function retrySession() {
    setSessionError(null);
    createSession.mutateAsync(undefined, {
      onSuccess: ({ id }) => { localStorage.setItem(SESSION_KEY, id); setSessionId(id); },
      onError: (e: unknown) => setSessionError(e instanceof Error ? e.message : "Failed to create session."),
    });
  }
  useEffect(() => {
    if (sessionId) return;
    retrySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── speechSynthesis voices load async ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // ── Proactive alerts: speak NEW critical signals aloud when idle ─────────────
  // Opt-in via the "Alerts on" toggle. announcedRef is seeded with the current
  // backlog at toggle-on so enabling doesn't speak a wall of existing alerts —
  // only signals that arrive AFTER enabling are spoken. Never interrupts an
  // active turn or the user speaking (waits for idle, then announces on the next poll).
  const announcedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!proactive) return;
    const sigs = signalList.data ?? [];
    const fresh = sigs.filter((s) => s.severity === "critical" && !announcedRef.current.has(String(s.id)));
    if (!fresh.length) return;
    if (isStreamingRef.current || listeningRef.current) return; // don't interrupt an active turn / the user
    const s = fresh[0];
    announcedRef.current.add(String(s.id));
    const text = s.category ? `${s.category}: ${s.message}` : s.message;
    speak(`Critical signal. ${text}`);
  }, [proactive, signalList.data]);

  // ── Audio playback queue (neural TTS) ───────────────────────────────────────
  function playNextAudio() {
    if (audioPlayingRef.current) return;
    const url = audioQueueRef.current.shift();
    if (!url || !audioRef.current) return;
    audioPlayingRef.current = true;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); // free the previous blob URL
    audioUrlRef.current = url;
    audioRef.current.src = url;
    audioRef.current.play().catch(() => { audioPlayingRef.current = false; });
  }
  function onAudioEnded() { audioPlayingRef.current = false; playNextAudio(); }

  // ── speechSynthesis fallback (no OPENAI key) ─────────────────────────────────
  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voicesRef.current.find((x) => /Google UK English Male|Microsoft Ryan|Daniel/i.test(x.name)) ?? voicesRef.current[0];
    if (v) u.voice = v;
    u.rate = 1.04;
    window.speechSynthesis.speak(u);
  }

  // ── Stream handlers ─────────────────────────────────────────────────────────
  function beginTurn(userText: string) {
    if (!sessionId) return;
    stopWake(); // mic is closed during the turn (no echo from TTS playback)
    const turn: Turn = { id: crypto.randomUUID(), user: userText, assistant: "", tools: [], screens: [], done: false, ts: Date.now() };
    turnRef.current = turn;
    activeTurnIdRef.current = turn.id;
    audioPlayedRef.current = false;
    setTurns((t) => [...t, turn]);
    setStatus("thinking");
    // All handlers are scoped to THIS turn (find by id, not "last turn") so a
    // barge-in starting a new turn can't have the old turn's stream clobber the
    // new one's state. activeTurnIdRef gates audio + status/re-arm so stale
    // events from the interrupted turn are dropped silently.
    start(userText, sessionId, {
      onToken: (tok) => {
        setStatus("speaking");
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l && !l.done) l.assistant += tok; return c; });
      },
      onToolCall: (name, args) => {
        setStatus("acting");
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l) l.tools.push({ name, args }); return c; });
      },
      onToolResult: (name, result) => {
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l) { const s = l.tools.find((s) => s.name === name && s.result === undefined); if (s) s.result = result; } return c; });
      },
      onAudio: (_seq, _mime, base64) => {
        if (activeTurnIdRef.current !== turn.id) return; // barge-in: drop stale TTS from the interrupted turn
        audioPlayedRef.current = true;
        audioQueueRef.current.push(URL.createObjectURL(b64ToBlob(base64, "audio/mpeg")));
        playNextAudio();
      },
      onScreen: (data) => {
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l) l.screens.push(data); return c; });
      },
      onApprovals: (apps) => setApprovals((prev) => [...prev.filter((p) => !apps.find((a) => a.nonce === p.nonce)), ...apps]),
      onTurnEnd: (content) => {
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l) { l.done = true; if (!l.assistant) l.assistant = content; } return c; });
        if (activeTurnIdRef.current !== turn.id) return; // a newer turn is live — don't clobber status / speak / re-arm
        setStatus("idle");
        if (!audioPlayedRef.current) speak(content);
        turnRef.current = null;
        // Re-arm listening for the next command: wake-word takes precedence
        // (ambient listener), else hands-free opens a single command-listen.
        if (wakeWordRef.current) micTimerRef.current = setTimeout(() => startWake(), 600);
        else if (handsFreeRef.current) micTimerRef.current = setTimeout(() => startMic(), 600);
      },
      onError: (msg) => {
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l) { l.done = true; l.error = msg; } return c; });
        if (activeTurnIdRef.current === turn.id) setStatus("error");
      },
      onStreamEnd: (aborted) => {
        // Stream closed (server drop, network error, user STOP, or barge-in).
        // Finalize THIS turn (find by id) so the spinner can't hang. Only touch
        // global status / turnRef if this is still the active turn — a barge-in
        // may have already started a newer turn whose state we must not clobber.
        setTurns((t) => { const c = [...t]; const l = c.find((x) => x.id === turn.id); if (l && !l.done) { l.done = true; if (!aborted && !l.assistant && !l.error) l.error = "Stream ended unexpectedly."; } return c; });
        if (activeTurnIdRef.current !== turn.id) return;
        setStatus((s) => (s === "thinking" || s === "speaking" || s === "acting") ? "idle" : s);
        if (turnRef.current === turn) turnRef.current = null;
      },
    }, { voiceId: voiceIdRef.current || undefined });
  }

  // ── Barge-in: interrupt Jarvis mid-utterance ────────────────────────────────
  function bargeIn() {
    // Silence browser TTS, flush the neural TTS audio queue, and abort the
    // in-flight stream. The aborted stream's onStreamEnd(true) finalizes the
    // partial turn without an error. Leaves the mic ready for a new command.
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    if (audioRef.current) audioRef.current.pause();
    audioQueueRef.current = [];
    audioPlayingRef.current = false;
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
    stop();
  }

  // ── Wake-word ambient listener (idle-only, so no TTS echo) ───────────────────
  // Web Speech allows only one SpeechRecognition active at a time, so the wake
  // listener and the command mic (startMic) are mutually exclusive — each stops
  // the other before starting. The wake listener is closed during turns (no echo
  // from Jarvis's own TTS) and re-arms after each reply.
  function stopWake() {
    if (wakeRestartRef.current) { clearTimeout(wakeRestartRef.current); wakeRestartRef.current = null; }
    const rec = wakeRecRef.current;
    wakeRecRef.current = null;
    if (rec) { try { rec.stop(); } catch {} }
  }
  function startWake() {
    if (isStreamingRef.current || listeningRef.current) return; // only when idle
    if (wakeRecRef.current) return;
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec: SpeechRecognitionLike = new Ctor();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onend = () => {
      wakeRecRef.current = null;
      // Browsers stop continuous recognition after silence. If wake word is still
      // on and we're still idle, restart so the assistant stays ambient.
      if (wakeWordRef.current && !isStreamingRef.current && !listeningRef.current) {
        wakeRestartRef.current = setTimeout(() => startWake(), 300);
      }
    };
    rec.onerror = (e) => {
      wakeRecRef.current = null;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setWakeWord(false);
        speak("Wake word off — microphone permission denied.");
        return;
      }
      if (e.error === "no-speech" || e.error === "aborted") return; // benign; onend restarts
    };
    rec.onresult = (ev) => {
      // Act on FINAL phrases only — avoids the interim-boundary race where
      // stopping the wake listener mid-utterance would split the command.
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      finalText = finalText.trim();
      if (!finalText) return;
      const m = finalText.toLowerCase().match(/^(hey\s+)?jarvis\b(.*)$/);
      if (!m) return; // not a wake phrase — keep listening
      stopWake();
      const trailing = m[2].trim();
      if (trailing) beginTurn(trailing); // "hey jarvis, take a screenshot" → one shot
      else startMic(true);               // "hey jarvis" → open a command-listen
    };
    wakeRecRef.current = rec;
    try { rec.start(); } catch { wakeRecRef.current = null; }
  }

  // ── Mic (Web Speech STT) ────────────────────────────────────────────────────
  function startMic(force = false) {
    stopWake(); // free the single SpeechRecognition slot
    if (!force && (isStreamingRef.current || listeningRef.current)) return;
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec: SpeechRecognitionLike = new Ctor();
    rec.lang = "en-US"; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onend = () => { setListening(false); setInterim(""); };
    rec.onerror = (e) => { setListening(false); setInterim(""); if (e.error !== "no-speech" && e.error !== "aborted") setStatus(`mic error: ${e.error}`); };
    rec.onresult = (ev) => {
      let finalText = "", interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalText += r[0].transcript; else interimText += r[0].transcript; }
      setInterim(interimText || finalText);
      if (finalText.trim()) { setInterim(""); beginTurn(finalText.trim()); }
    };
    recognitionRef.current = rec;
    rec.start();
  }
  function toggleMic() {
    if (listening) { recognitionRef.current?.stop(); return; }
    if (isStreaming) { bargeIn(); startMic(true); return; } // barge-in: interrupt + take a new command
    startMic();
  }

  // ── Approve a pending op ───────────────────────────────────────────────────
  async function confirmApproval(nonce: string) {
    const res = await approve(nonce);
    setApprovals((prev) => prev.filter((p) => p.nonce !== nonce));
    utils.jarvis.sessionList.invalidate();
    if (res.ok) speak(res.label ? `${res.label} complete.` : "Operation complete.");
    else speak(`Operation failed: ${res.output}`);
    setTurns((t) => { const c = [...t]; const l = c[c.length - 1]; if (l) l.tools.push({ name: res.kind ?? "approval", args: { approved: true }, result: res.output }); return c; });
  }

  // ── Permission toggles ─────────────────────────────────────────────────────
  function toggleAllowShell() {
    if (!sessionId) return;
    const next = !allowShell; setAllowShell(next); setAllowShellMut.mutate({ id: sessionId, allow: next });
  }
  function toggleAllowOsControl() {
    if (!sessionId) return;
    const next = !allowOsControl; setAllowOsControl(next); setAllowOsControlMut.mutate({ id: sessionId, allow: next });
  }
  function toggleAllowRawShell() {
    if (!sessionId) return;
    if (!allowRawShell && !rawShellConfirm) { setRawShellConfirm(true); return; }
    const next = !allowRawShell; setAllowRawShell(next); setRawShellConfirm(false); setAllowRawShellMut.mutate({ id: sessionId, allow: next });
  }
  function toggleSituational() {
    if (!sessionId) return;
    const next = !situational; setSituational(next); setSituationalMut.mutate({ id: sessionId, allow: next }); speak(next ? "Eyes on." : "Eyes off.");
  }
  function toggleHandsFree() {
    const next = !handsFree; setHandsFree(next);
    if (next && !isStreamingRef.current && !listeningRef.current) micTimerRef.current = setTimeout(() => startMic(), 200);
    speak(next ? "Hands free on." : "Hands free off.");
  }
  function toggleProactive() {
    const next = !proactive; setProactive(next);
    if (next) {
      // Seed announced with current criticals so only signals arriving AFTER
      // enabling speak — no backlog avalanche.
      for (const s of (signalList.data ?? [])) if (s.severity === "critical") announcedRef.current.add(String(s.id));
      speak("Proactive alerts on.");
    } else {
      speak("Proactive alerts off.");
    }
  }
  function toggleWakeWord() {
    const next = !wakeWord; setWakeWord(next);
    if (next) {
      speak("Wake word on. Say hey Jarvis.");
      startWake(); // no-op if not idle; re-arms at the next turn_end
    } else {
      if (micTimerRef.current) clearTimeout(micTimerRef.current); // cancel pending re-arm
      stopWake();
      speak("Wake word off.");
    }
  }

  const busy = isStreaming || listening;
  const orbState = listening ? "listening" : isStreaming ? (status === "acting" ? "acting" : status === "speaking" ? "speaking" : "thinking") : "idle";
  const OrbIcon = orbState === "listening" ? MicOff : orbState === "thinking" ? Loader2 : orbState === "speaking" ? AudioLines : orbState === "acting" ? Zap : Mic;

  return (
    <div className="relative flex flex-col h-[calc(100vh-88px)] overflow-hidden">
      {/* ── Ambient HUD background ─────────────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255,26,26,0.10), transparent 70%)" }} />
        <div className="jarvis-grid absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "linear-gradient(rgba(255,26,26,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,26,26,0.25) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="jarvis-scanline absolute left-0 right-0 h-32" style={{ background: "linear-gradient(to bottom, transparent, rgba(255,26,26,0.06), transparent)" }} />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl tracking-[0.35em] text-red-primary drop-shadow-[0_0_12px_rgba(255,26,26,0.5)]">JARVIS</h1>
        <StatusChip orbState={orbState} status={status} />
        {situational && <Chip tone="success" icon={Eye} label="EYES" pulse />}
        {handsFree && <Chip tone="info" icon={Radio} label="HANDS-FREE" />}
        {wakeWord && <Chip tone="info" icon={Radar} label="WAKE" pulse />}
        <span className="ml-auto font-mono text-[10px] text-text-muted tracking-wider">
          {sessionList.data?.length ?? 0} SESSIONS · {sessionId ? sessionId.slice(0, 8) : "…"}
        </span>
      </div>

      {!supported && (
        <div className="relative z-10 border border-warning/40 bg-warning/5 rounded px-3 py-2 mb-3 font-mono text-xs text-warning">
          Voice input needs Chrome or Edge (Web Speech API). You can still type below.
        </div>
      )}

      {sessionError && (
        <div className="relative z-10 flex items-center gap-3 border border-error/40 bg-error/10 rounded px-3 py-2 mb-3 font-mono text-xs text-error">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="flex-1">Jarvis session failed: {sessionError}</span>
          <button onClick={retrySession} disabled={createSession.isPending} className="font-mono text-xs tracking-widest px-3 py-1 rounded border border-error/60 hover:bg-error hover:text-black disabled:opacity-50 shrink-0">RETRY</button>
        </div>
      )}

      {/* ── Orb + waveform (hero) ───────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center justify-center py-4">
        <button
          onClick={toggleMic}
          disabled={!supported}
          aria-label="Tap to speak, or tap while Jarvis talks to interrupt"
          className={`relative grid place-items-center w-32 h-32 rounded-full border-2 transition-colors disabled:opacity-50 ${
            orbState === "listening" ? "border-red-primary jarvis-orb-breathe bg-red-primary/10"
            : orbState === "thinking" || orbState === "speaking" || orbState === "acting" ? "border-red-glow bg-red-primary/5"
            : "border-red-dark/60 bg-void hover:border-red-primary"
          }`}
        >
          {/* listening rings */}
          {orbState === "listening" && (
            <>
              <span className="jarvis-ring absolute inset-0 rounded-full border border-red-primary/40" />
              <span className="jarvis-ring absolute inset-0 rounded-full border border-red-primary/30" style={{ animationDelay: "0.7s" }} />
              <span className="jarvis-ring absolute inset-0 rounded-full border border-red-primary/20" style={{ animationDelay: "1.4s" }} />
            </>
          )}
          {/* thinking orbit arc */}
          {(orbState === "thinking" || orbState === "acting") && (
            <span className="jarvis-spin absolute inset-[-6px] rounded-full border-2 border-transparent border-t-red-primary border-r-red-primary/40" />
          )}
          <OrbIcon className={`relative w-10 h-10 text-red-primary ${orbState === "thinking" ? "animate-spin" : ""}`} />
        </button>

        {/* waveform */}
        <div className="flex items-end gap-1 h-6 mt-4">
          {(orbState === "listening" || orbState === "speaking" ? 18 : 0) > 0 &&
            Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className="jarvis-wave-bar w-1 rounded-full bg-red-primary/70"
                style={{ height: "100%", animationDelay: `${(i % 6) * 0.08}s`, animationDuration: orbState === "listening" ? "0.7s" : "0.45s", opacity: 0.4 + (i % 4) * 0.15 }}
              />
            ))}
          {orbState !== "listening" && orbState !== "speaking" && (
            <span className="font-mono text-[11px] text-text-muted tracking-[0.3em] uppercase">{orbState === "idle" ? "tap to speak" : orbState}</span>
          )}
        </div>

        {(orbState === "speaking" || orbState === "acting" || orbState === "thinking") && (
          <div className="mt-1.5 font-mono text-[10px] text-text-muted tracking-[0.25em] uppercase">tap orb to interrupt</div>
        )}

        {/* interim transcript */}
        {listening && interim && (
          <div className="mt-2 font-mono text-sm text-text-secondary italic">“{interim}…”</div>
        )}

        {/* stop control */}
        <AnimatePresence>
          {isStreaming && (
            <motion.button
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              onClick={stop}
              className="mt-3 flex items-center gap-2 px-4 py-1.5 rounded-full font-mono text-xs tracking-widest bg-void text-error border border-error/60 hover:bg-error hover:text-black transition-colors"
            >
              <Square className="w-3 h-3" fill="currentColor" /> STOP
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Transcript feed ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 overflow-y-auto border border-red-dark/30 bg-void/60 backdrop-blur-sm rounded-lg p-4 space-y-3 min-h-0">
        {turns.length === 0 && (
          <div className="font-mono text-xs text-text-muted leading-relaxed">
            <p className="text-text-secondary mb-1">Tap the orb and speak.</p>
            Jarvis listens, thinks out loud, and acts — it dispatches to OPA, queries NEXUS, controls SAHIIX services, and with the toggles below, sees your screen and drives this Windows box.
            <p className="mt-2 text-text-muted">Try: <span className="text-red-primary">“take a screenshot”</span> · <span className="text-red-primary">“system status”</span> · <span className="text-red-primary">“open Notepad”</span> · <span className="text-red-primary">“dark mode on”</span></p>
            <p className="mt-2">Turn on <span className="text-success">Eyes on</span> for situational awareness and <span className="text-info">Hands-free</span> to chain commands.</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {turns.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
              {/* timestamp */}
              <div className="font-mono text-[9px] text-text-dim tracking-wider">{new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>

              {/* user */}
              <div className="flex justify-end">
                <div className="bg-red-primary/10 border border-red-primary/30 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[80%] font-mono text-sm text-text-primary">
                  {t.user}
                </div>
              </div>

              {/* tools */}
              {t.tools.map((tool, i) => <ToolCard key={i} tool={tool} />)}

              {/* screens */}
              {t.screens.length > 0 && (
                <div className="flex justify-start">
                  <div className="border border-info/40 bg-info/5 rounded p-1 max-w-[85%]">
                    <div className="font-mono text-[9px] text-info tracking-widest px-1 pb-1">SCREEN CAPTURE</div>
                    {t.screens.map((s, i) => (
                      <img key={i} src={`data:${s.mime};base64,${s.base64}`} alt={`Screenshot ${i + 1}`} className="max-w-full rounded" style={{ maxHeight: 260 }} />
                    ))}
                  </div>
                </div>
              )}

              {/* assistant */}
              {(t.assistant || !t.done) && (
                <div className="flex justify-start">
                  <div className="border-l-2 border-red-primary bg-surface/70 rounded-r-lg px-3 py-2 max-w-[85%] font-mono text-sm text-text-secondary">
                    {t.assistant || <Loader2 className="inline w-3 h-3 animate-spin text-red-primary" />}
                  </div>
                </div>
              )}
              {t.error && (
                <div className="font-mono text-xs text-error border border-error/40 bg-error/10 rounded px-3 py-2">{t.error}</div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Pending approvals ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {approvals.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="relative z-10 mt-3 space-y-2">
            {approvals.map((a) => (
              <div key={a.nonce} className="flex items-center gap-3 border border-warning/50 bg-warning/10 rounded-lg px-4 py-2.5">
                <ShieldAlert className="w-5 h-5 text-warning shrink-0" />
                <div className="min-w-0">
                  <div className="font-mono text-[9px] text-warning tracking-widest">CONFIRMATION REQUIRED</div>
                  <div className="font-mono text-xs text-text-primary break-all">{a.label}</div>
                </div>
                <button
                  onClick={() => confirmApproval(a.nonce)}
                  className="ml-auto font-mono text-xs tracking-widest px-4 py-2 rounded-md bg-warning text-black hover:opacity-80 shrink-0 shadow-[0_0_18px_rgba(255,170,0,0.4)]"
                >
                  CONFIRM
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Control rail (toggle switches) ─────────────────────────────────── */}
      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
        <Toggle on={allowShell} onClick={toggleAllowShell} label="Service control" icon={Server} tone="error" />
        <Toggle on={allowOsControl} onClick={toggleAllowOsControl} label="OS control" icon={Power} tone="error" />
        <Toggle
          on={allowRawShell}
          onClick={toggleAllowRawShell}
          label={rawShellConfirm ? "Click AGAIN to confirm RAW SHELL" : "Raw shell"}
          icon={Terminal}
          tone="error"
          arming={rawShellConfirm}
        />
        <Toggle on={situational} onClick={toggleSituational} label="Eyes on" icon={Eye} tone="success" />
        <Toggle on={handsFree} onClick={toggleHandsFree} label="Hands-free" icon={Radio} tone="info" />
        <Toggle on={proactive} onClick={toggleProactive} label="Alerts on" icon={Bell} tone="info" />
        <Toggle on={wakeWord} onClick={toggleWakeWord} label="Wake word" icon={Radar} tone="info" />
        {voicesQuery.data?.available && voicesQuery.data.voices.length > 0 && (
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-text-secondary border border-surface-hover bg-void rounded-full px-3 py-1">
            <AudioLines className="w-3 h-3 text-sara" />
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="bg-transparent text-text-primary outline-none cursor-pointer max-w-[140px]"
            >
              <option value="">env default</option>
              {voicesQuery.data.voices.map((v: { voice_id: string; name: string; category: string }) => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="relative z-10 mt-2 font-mono text-[10px] text-text-muted leading-relaxed">
        Jarvis runs locally — OPA (:8082) + Ollama (:11434) must be running. With no keys set, the LLM uses local Ollama and voice uses the browser. OS-control + raw-shell run PowerShell on this box; destructive actions ask for confirmation. Eyes-on captures the screen + system state before each turn; Hands-free auto-restarts the mic after each reply; Alerts on speaks new critical signals aloud as they arrive (polls the Signals feed); Wake word listens for "hey Jarvis" while idle and starts a turn hands-free (mic is off during replies so there's no echo — best with headphones so ambient speech doesn't false-fire it).
      </div>

      {/* hidden audio element for neural TTS playback */}
      <audio ref={audioRef} onEnded={onAudioEnded} className="hidden" />
    </div>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ orbState, status }: { orbState: string; status: string }) {
  const tone = orbState === "listening" ? "text-red-primary" : orbState === "thinking" ? "text-warning" : orbState === "speaking" ? "text-info" : orbState === "acting" ? "text-success" : "text-text-muted";
  const label = status.toUpperCase();
  return (
    <span className={`flex items-center gap-1.5 font-mono text-xs ${tone}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${orbState !== "idle" ? "bg-current animate-status-pulse" : "bg-text-muted"}`} />
      {label}
    </span>
  );
}

function Chip({ tone, icon: Icon, label, pulse }: { tone: "success" | "info"; icon: typeof Mic; label: string; pulse?: boolean }) {
  const c = tone === "success" ? "text-success border-success/40 bg-success/10" : "text-info border-info/40 bg-info/10";
  return (
    <span className={`flex items-center gap-1 font-mono text-[10px] tracking-wider border rounded px-1.5 py-0.5 ${c}`}>
      <Icon className={`w-3 h-3 ${pulse ? "animate-status-pulse" : ""}`} /> {label}
    </span>
  );
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
// NOTE: Tailwind JIT only generates classes it can see as complete strings, so
// tone variants live in explicit maps (no `border-${tone}/60` interpolation).
const TONE_ON: Record<string, string> = {
  success: "border-success/60 bg-success/10 text-success",
  info: "border-info/60 bg-info/10 text-info",
  error: "border-error/60 bg-error/10 text-error",
};
const TONE_TRACK: Record<string, string> = { success: "bg-success/40", info: "bg-info/40", error: "bg-error/40" };
const TONE_KNOB: Record<string, string> = { success: "bg-success left-3.5", info: "bg-info left-3.5", error: "bg-error left-3.5" };
const TONE_ICON: Record<string, string> = { success: "text-success", info: "text-info", error: "text-error" };

function Toggle({ on, onClick, label, icon: Icon, tone, arming }: { on: boolean; onClick: () => void; label: string; icon: typeof Mic; tone: "error" | "success" | "info"; arming?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all font-mono text-xs ${
        on ? TONE_ON[tone]
        : arming ? "border-error bg-error/20 text-error animate-status-pulse"
        : "border-surface-hover bg-void text-text-secondary hover:border-text-muted"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${on ? TONE_ICON[tone] : "text-text-muted"}`} />
      <span>{label}</span>
      <span className={`relative w-7 h-3.5 rounded-full transition-colors ${on ? TONE_TRACK[tone] : "bg-surface-hover"}`}>
        <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all ${on ? TONE_KNOB[tone] : "left-0.5 bg-text-muted"}`} />
      </span>
    </button>
  );
}

// ── Tool call/result inline card ──────────────────────────────────────────────
function ToolCard({ tool }: { tool: ToolStep }) {
  const hasResult = tool.result !== undefined;
  const isErr = tool.result?.startsWith("Error:");
  const Icon = TOOL_ICON[tool.name] ?? Terminal;
  return (
    <div className="flex justify-start">
      <div className={`border rounded-lg px-3 py-1.5 max-w-[85%] font-mono text-xs ${isErr ? "border-error/40 bg-error/5" : "border-info/30 bg-info/5"}`}>
        <div className={`flex items-center gap-2 ${isErr ? "text-error" : "text-info"}`}>
          {hasResult ? (isErr ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3 text-success" />) : <Loader2 className="w-3 h-3 animate-spin" />}
          <Icon className="w-3.5 h-3.5" />
          <span className="tracking-wider">{tool.name}</span>
        </div>
        <div className="text-text-muted mt-0.5 break-all">{JSON.stringify(tool.args).slice(0, 160)}</div>
        {hasResult && (
          <div className={`mt-0.5 break-all ${isErr ? "text-error" : "text-text-secondary"}`}>
            → {tool.result!.slice(0, tool.name === "win_script" ? 1200 : 240)}
          </div>
        )}
      </div>
    </div>
  );
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Minimal Web Speech API typings (the lib doesn't ship them).
interface SpeechRecognitionLike extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void;
  onstart: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }> }) => void) | null;
}