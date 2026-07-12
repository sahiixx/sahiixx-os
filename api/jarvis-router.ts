// tRPC router for Jarvis session management (the realtime turn itself bypasses
// tRPC and uses the raw SSE route in jarvis/stream.ts). v1 reads from the
// in-memory session map in jarvis/stream.ts — no DB. Procedure signatures are
// stable so v1.1 can swap in Drizzle/Neon without touching the client.
import { z } from "zod";
import { router, protectedProcedure } from "./context";
import { listSessionsForUser, getMessages, setAllowShell, setAllowOsControl, setAllowRawShell, setSituational } from "./jarvis/stream";
import { listSapiVoices } from "./jarvis/sapi";
import { env } from "./lib/env";

function newId() {
  // Works in Node 18+ and Cloudflare Workers (both expose globalThis.crypto.randomUUID).
  return globalThis.crypto.randomUUID();
}

export const jarvisRouter = router({
  sessionList: protectedProcedure.query(({ ctx }) => listSessionsForUser(ctx.user!.email)),

  sessionCreate: protectedProcedure.mutation(() => ({ id: newId() })),

  sessionMessages: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => getMessages(input.id, ctx.user!.email) ?? []),

  setAllowShell: protectedProcedure
    .input(z.object({ id: z.string(), allow: z.boolean() }))
    .mutation(({ ctx, input }) => ({ ok: setAllowShell(input.id, ctx.user!.email, input.allow) })),

  setAllowOsControl: protectedProcedure
    .input(z.object({ id: z.string(), allow: z.boolean() }))
    .mutation(({ ctx, input }) => ({ ok: setAllowOsControl(input.id, ctx.user!.email, input.allow) })),

  setAllowRawShell: protectedProcedure
    .input(z.object({ id: z.string(), allow: z.boolean() }))
    .mutation(({ ctx, input }) => ({ ok: setAllowRawShell(input.id, ctx.user!.email, input.allow) })),

  setSituational: protectedProcedure
    .input(z.object({ id: z.string(), allow: z.boolean() }))
    .mutation(({ ctx, input }) => ({ ok: setSituational(input.id, ctx.user!.email, input.allow) })),

  // List available TTS voices for the Jarvis voice-picker. Prefers ElevenLabs
  // (GET /v1/voices → [{voice_id, name, category}]); when the key is missing or
  // DEAD (401) it falls back to the keyless Windows SAPI installed voices so the
  // picker is never empty — voice_id = the SAPI voice name, category "Windows".
  // The same voiceId flows to synthSpeech, which passes it to sapiSynth as the
  // SAPI voice name (and to ElevenLabs as voice_id when that provider is live).
  voices: protectedProcedure.query(async () => {
    if (env.elevenLabsApiKey) {
      try {
        const res = await fetch("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": env.elevenLabsApiKey },
        });
        if (res.ok) {
          const json: any = await res.json();
          const voices = (json.voices ?? []).map((v: any) => ({
            voice_id: v.voice_id, name: v.name, category: v.category ?? "",
          }));
          if (voices.length) return { available: true, voices };
        }
      } catch {
        // fall through to SAPI
      }
    }
    // Keyless floor — Windows SAPI installed voices.
    const names = await listSapiVoices();
    const voices = names.map((n) => ({ voice_id: n, name: n, category: "Windows" }));
    return { available: voices.length > 0, voices };
  }),
});