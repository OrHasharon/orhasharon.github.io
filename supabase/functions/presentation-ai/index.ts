// "עוזר מצגת ב-AI" — the presentation helper in the WorshipAndSound "האסיפה הקרובה" tab.
// The site sends one meeting's songs (ChordPro) + prayer requests and the user's request in Hebrew; Claude returns
// only what should change. Nothing is saved here: the site shows the changes and saves them itself after the user
// confirms (with the user's own sign-in, so the database's row-level security still decides).
// Only signed-in team members (or_hasharon_worship.is_allowed()) may call it — the API key costs money.
// Secret: ANTHROPIC_API_KEY (Supabase dashboard → Edge Functions → Secrets).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = `You help the worship team of a Hebrew-speaking congregation (קהילת אור השרון) fix the slides of one meeting's presentation.

What you can change:
1. Songs of this meeting, stored as ChordPro text:
   - [C], [Am7] … are chords inside a lyric line; a line with only chords is ignored by the slides.
   - {label} on its own line (e.g. {פזמון}) starts a new section; {key: G}, {capo: 2}, {screen: quiet} are settings — keep them.
   - A blank line also starts a new section (stanza).
   How slides are made: every section becomes its own slide(s) of at most 4 lines, split as evenly as possible
   (5 lines → 3+2, 6 → 3+3, 7 → 4+3, 8 → 4+4). So: to keep lines together on one slide, put them in one section of
   at most 4 lines; to split a slide, add a blank line where it should break. A section can't show more than 4 lines on
   one slide.
2. The prayer requests (בקשות תפילה) slide text: one request per line; a line starting with "-" is a sub-bullet;
   words between *stars* are shown in orange (names).

Rules:
- Change only what the request asks. Everything else must stay exactly as it was: chords, niqqud, punctuation, order,
  settings lines. Never invent lyrics.
- Return only the songs you changed, each with its full new content. Set prayers_changed to false and prayers to ""
  unless you changed the prayer requests (then return the full new text).
- reply: a short message in Hebrew to the team member: what you changed (song names, which slides), or why you
  couldn't. If the request is about something you can't change (pictures, design, fixed slides, other meetings),
  change nothing and say so in reply.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    songs: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, content: { type: "string" } },
        required: ["id", "content"],
        additionalProperties: false,
      },
    },
    prayers_changed: { type: "boolean" },
    prayers: { type: "string" },
  },
  required: ["reply", "songs", "prayers_changed", "prayers"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // the caller must be a signed-in team member
  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    db: { schema: "or_hasharon_worship" },
  });
  const { data: allowed, error: authError } = await sb.rpc("is_allowed");
  if (authError || allowed !== true) return json({ error: "not_allowed" }, 403);

  let body: { instruction?: string; meeting?: string; songs?: { id: number; title: string; content: string }[]; prayers?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const instruction = (body.instruction || "").trim().slice(0, 2000);
  if (!instruction) return json({ error: "empty" }, 400);
  const songs = (body.songs || []).slice(0, 20);

  const data = [
    `Meeting: ${body.meeting || ""}`,
    ...songs.map((s) => `<song id="${s.id}" title="${s.title}">\n${s.content}\n</song>`),
    `<prayers>\n${body.prayers || ""}\n</prayers>`,
  ].join("\n\n");

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `${data}\n\nRequest from the team member:\n${instruction}` }],
    });
    if (response.stop_reason === "refusal") return json({ error: "refusal" }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "too_long" }, 422);
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const out = JSON.parse(text);
    // only songs that were sent, and only real changes
    const sent = new Map(songs.map((s) => [s.id, s.content]));
    out.songs = (out.songs || []).filter((s: { id: number; content: string }) => sent.has(s.id) && sent.get(s.id) !== s.content);
    return json(out);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "no_key" }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: "api", status: err.status }, 502);
    console.error(err);
    return json({ error: "failed" }, 500);
  }
});
