// tRPC router for Jarvis session management (the realtime turn itself bypasses
// tRPC and uses the raw SSE route in jarvis/stream.ts). v1 reads from the
// in-memory session map in jarvis/stream.ts — no DB. Procedure signatures are
// stable so v1.1 can swap in Drizzle/Neon without touching the client.
import { z } from "zod";
import { router, protectedProcedure } from "./context";
import { listSessionsForUser, getMessages, setAllowShell, setAllowOsControl, setAllowRawShell, setSituational } from "./jarvis/stream";
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

  // List available ElevenLabs voices for the Jarvis voice-picker. Returns
  // [{voice_id, name, category}] from GET /v1/voices. Empty array when no key
  // is set (client hides the picker and uses the env default / browser TTS).
  voices: protectedProcedure.query(async () => {
    if (!env.elevenLabsApiKey) return { available: false, voices: [] as { voice_id: string; name: string; category: string }[] };
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": env.elevenLabsApiKey },
      });
      if (!res.ok) return { available: false, voices: [] };
      const json: any = await res.json();
      const voices = (json.voices ?? []).map((v: any) => ({
        voice_id: v.voice_id, name: v.name, category: v.category ?? "",
      }));
      return { available: true, voices };
    } catch {
      return { available: false, voices: [] };
    }
  }),
});