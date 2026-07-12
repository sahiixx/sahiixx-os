// Keyless streaming TTS voice source: a PERSISTENT Windows SAPI synthesizer.
//
// Why persistent: spawning powershell.exe + loading System.Speech costs ~600ms
// PER SENTENCE if we cold-start every time (the old execFile-per-call path). That
// spinup is longer than a fast cloud model takes to emit all its tokens, so audio
// bunches at the end of the turn instead of streaming during generation. Keeping
// ONE warm PowerShell process alive across turns cuts per-sentence synth to
// ~25–45ms (measured), so audio really interleaves with tokens — the real-time
// voice property. First-ever sentence pays a one-time ~1.5s cold start; we pre-warm
// at module load to push that off the critical path.
//
// Protocol: the child runs a read-loop. For each request we write a base64(utf8
// text) line to stdin; the child synthesizes to WAV, writes base64 WAV + a
// "<<END>>" sentinel line to stdout. We frame on the sentinel (not on newlines,
// since the WAV base64 is one long line that may arrive across several data
// chunks). "<<ERR>>" prefix on the chunk = synth error → null. Local-dev only
// (Cloudflare Workers can't spawn powershell); no key, no download, no egress.
//
// All synth calls are serialized through a promise chain: the synthLoop in
// stream.ts is already sequential, but the init warmup must not race a real
// call, and a future concurrent turn would otherwise interleave frames.

import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";

const SENTINEL = "<<END>>";
const ERR_PREFIX = "<<ERR>>";
const QUIT = "<<QUIT>>";
const SYNTH_TIMEOUT_MS = 15000;

// Persistent-synth protocol: each request is ONE JSON line
//   {"v":"<base64 voice name or empty>","t":"<base64 utf8 text>"}
// base64 on both fields so neither voice name nor text can break JSON or
// PowerShell parsing. The child decodes, optionally SelectVoice, then speaks.
const SCRIPT =
  "$ErrorActionPreference='Stop';" +
  "Add-Type -AssemblyName System.Speech;" +
  "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
  "$s.Rate=1;" +
  "$default=$s.Voice.Name;" + // capture the OS default voice BEFORE any SelectVoice
  "while($true){" +
  "  $line=[Console]::In.ReadLine();" +
  "  if($null -eq $line){break};" +
  "  if($line -eq '" + QUIT + "'){break};" +
  "  try{" +
  "    $o=$line | ConvertFrom-Json;" +
  "    $t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($o.t));" +
  "    if($o.v){" +
  "      $vn=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($o.v));" +
  "      try { $s.SelectVoice($vn) } catch {}" + // bad voice → keep current, don't drop the sentence
  "    } else {" +
  "      try { $s.SelectVoice($default) } catch {}" + // reset to OS default — no voice-state leakage across requests
  "    };" +
  "    $ms=New-Object System.IO.MemoryStream;" +
  "    $s.SetOutputToWaveStream($ms);" +
  "    $s.Speak($t);" +
  "    $b=[Convert]::ToBase64String($ms.ToArray());" +
  "    [Console]::Out.WriteLine($b);" +
  "    [Console]::Out.WriteLine('" + SENTINEL + "');" +
  "    [Console]::Out.Flush();" +
  "  }catch{" +
  "    [Console]::Out.WriteLine('" + ERR_PREFIX + "'+$_.Exception.Message);" +
  "    [Console]::Out.WriteLine('" + SENTINEL + "');" +
  "    [Console]::Out.Flush();" +
  "  }" +
  "}";

class SapiProcess {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuf = "";
  private waiter: ((b64: string | null) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private warming = false;

  /** Serialize every synth (incl. warmup) so frames can't interleave. */
  synth(text: string, voice: string | null = null): Promise<string | null> {
    const run = () => this.synthOnce(text, voice);
    const r = this.chain.then(run, run);
    this.chain = r.catch(() => undefined);
    return r as Promise<string | null>;
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed) return this.proc;
    const enc = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", enc]);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d: string) => this.onData(d));
    p.on("exit", () => {
      this.proc = null;
      this.stdoutBuf = "";
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(null); // release the in-flight call; caller skips that sentence
      }
    });
    p.on("error", () => {
      this.proc = null;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(null);
      }
    });
    this.proc = p;
    this.stdoutBuf = "";
    return p;
  }

  private onData(d: string) {
    this.stdoutBuf += d;
    let idx: number;
    while ((idx = this.stdoutBuf.indexOf(SENTINEL)) >= 0) {
      const chunk = this.stdoutBuf.slice(0, idx);
      // skip the single newline that follows the sentinel
      const after = this.stdoutBuf.slice(idx + SENTINEL.length);
      this.stdoutBuf = after.startsWith("\r\n") ? after.slice(2) : after.startsWith("\n") ? after.slice(1) : after;
      if (!this.waiter) continue; // stray frame (e.g. late warmup) — drop
      const w = this.waiter;
      this.waiter = null;
      const clean = chunk.replace(/\s+/g, "");
      w(clean.startsWith(ERR_PREFIX) || !clean ? null : clean);
    }
  }

  private synthOnce(text: string, voice: string | null): Promise<string | null> {
    if (!text.trim()) return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        this.waiter = null;
        resolve(v);
      };
      const to = setTimeout(() => {
        // hung synth — kill the process so the next call respawns fresh
        this.waiter = null;
        if (this.proc) {
          this.proc.removeAllListeners("exit");
          this.proc.kill();
          this.proc = null;
        }
        finish(null);
      }, SYNTH_TIMEOUT_MS);
      this.waiter = finish;
      try {
        const p = this.ensure();
        const line =
          JSON.stringify({
            v: voice ? Buffer.from(voice, "utf8").toString("base64") : "",
            t: Buffer.from(text, "utf8").toString("base64"),
          }) + "\n";
        const ok = p.stdin.write(line, (err) => {
          if (err) finish(null);
        });
        if (!ok) p.stdin.once("drain", () => {});
      } catch {
        finish(null);
      }
    });
  }

  /** Fire-and-forget warmup so System.Speech loads before the first real turn. */
  warm() {
    if (this.warming) return;
    this.warming = true;
    this.synth("Ready.").then(() => undefined, () => undefined);
  }

  shutdown() {
    try {
      this.proc?.stdin?.write(QUIT + "\n");
    } catch {}
    try {
      this.proc?.stdin?.end();
    } catch {}
  }
}

let sapi: SapiProcess | null = null;
function getSapi(): SapiProcess {
  if (!sapi) sapi = new SapiProcess();
  return sapi;
}

/** Synthesize one sentence to base64 WAV (mime audio/wav). Null on any failure.
 *  Caller skips the sentence and the client speechSynthesis fallback covers it.
 *  `voice` = an installed SAPI voice name (from listSapiVoices); null = default. */
export function sapiSynth(text: string, voice: string | null = null): Promise<string | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return getSapi().synth(text, voice);
}

/** List installed Windows SAPI voices (keyless). Used by the voices tRPC
 *  procedure as a fallback when ElevenLabs is unavailable/dead, so the voice
 *  picker shows real keyless voices instead of hiding. One-shot execFile —
 *  this is a rare query, not the per-sentence hot path, so no need to persist. */
export function listSapiVoices(): Promise<string[]> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    const script =
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }";
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { encoding: "utf8", timeout: 15000, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        const names = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        resolve(names);
      },
    );
  });
}

/** Pre-warm the persistent SAPI process at server boot so the first user turn
 *  doesn't pay the ~1.5s cold start (PowerShell + System.Speech load). */
export function warmSapi(): void {
  if (process.platform !== "win32") return;
  getSapi().warm();
}