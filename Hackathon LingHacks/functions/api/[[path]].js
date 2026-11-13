// Handles every /api/* route on Cloudflare Pages.
// Mirrors the routes in main.py so the same index.html works locally and online.
import { ELEVENLABS_BASE, json, err, resolveKey, elevenError, roomCode, token, roomStub } from "../_lib.js";

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const route = parts.join("/");
  const method = request.method;

  try {
    // ── Rooms (no ElevenLabs key needed) ──
    if (route === "rooms/create" && method === "POST") return createRoom(env);
    if (parts[0] === "rooms" && parts.length === 3 && parts[2] === "exists" && method === "GET") {
      const r = await roomStub(env, parts[1].toUpperCase()).fetch("https://room/exists");
      return new Response(r.body, r);
    }
    if (parts[0] === "rooms" && parts.length === 2 && method === "DELETE") {
      const t = new URL(request.url).searchParams.get("host_token") || "";
      const r = await roomStub(env, parts[1].toUpperCase()).fetch(
        "https://room/close?host_token=" + encodeURIComponent(t), { method: "POST" });
      return new Response(r.body, r);
    }

    // ── ElevenLabs proxy ──
    const { key, error } = resolveKey(request, env);
    if (error) return error;
    const xi = { "xi-api-key": key };

    if (route === "status" && method === "GET") {
      const r = await fetch(`${ELEVENLABS_BASE}/user`, { headers: xi });
      if (!r.ok) return err(401, "ElevenLabs API key is invalid or quota exceeded.");
      const d = await r.json();
      return json({ ok: true, name: d.first_name || "User", tier: d.subscription?.tier || "free" });
    }

    if (route === "voices" && method === "GET") {
      const r = await fetch(`${ELEVENLABS_BASE}/voices`, { headers: xi });
      if (!r.ok) return err(r.status, "Failed to fetch voices");
      const d = await r.json();
      return json((d.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category || "premade" })));
    }

    if (parts[0] === "voices" && parts.length === 2 && method === "DELETE") {
      const r = await fetch(`${ELEVENLABS_BASE}/voices/${encodeURIComponent(parts[1])}`, { method: "DELETE", headers: xi });
      if (!r.ok) return err(r.status, "Failed to delete voice");
      return json({ deleted: true });
    }

    if (route === "clone-voice" && method === "POST") {
      const form = await request.formData();
      const name = String(form.get("voice_name") || "My Voice");
      const file = form.get("audio_file");
      if (!file || typeof file === "string") return err(400, "No audio file received.");
      const out = new FormData();
      out.append("files", file, file.name || "recording.webm");
      out.append("name", name);
      out.append("description", `VoiceFlow cloned voice: ${name}`);
      const r = await fetch(`${ELEVENLABS_BASE}/voices/add`, { method: "POST", headers: xi, body: out });
      if (!r.ok) return elevenError(r);
      const d = await r.json();
      return json({ voice_id: d.voice_id, name });
    }

    if (route === "tts" && method === "POST") {
      const req = await request.json();
      if (!req.voice_id || !req.text) return err(400, "voice_id and text are required.");
      const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(req.voice_id)}`, {
        method: "POST",
        headers: { ...xi, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: req.text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: req.stability ?? 0.5,
            similarity_boost: req.similarity_boost ?? 0.75,
            style: req.style ?? 0,
            use_speaker_boost: true,
          },
        }),
      });
      if (!r.ok) return elevenError(r);
      return new Response(r.body, {
        headers: { "Content-Type": "audio/mpeg", "Content-Disposition": "inline; filename=speech.mp3" },
      });
    }

    return err(404, "Not found");
  } catch (e) {
    return err(500, e.message || String(e));
  }
}

async function createRoom(env) {
  for (let i = 0; i < 20; i++) {
    const code = roomCode();
    const host_token = token();
    const r = await roomStub(env, code).fetch("https://room/init", {
      method: "POST",
      body: JSON.stringify({ token: host_token }),
    });
    if (r.status === 409) continue; // code already taken, try another
    if (!r.ok) return err(r.status, await r.text());
    return json({ room_code: code, host_token });
  }
  return err(503, "Could not generate unique room code.");
}
