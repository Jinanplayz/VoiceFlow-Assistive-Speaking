// Shared helpers for the Cloudflare Pages Functions.
export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function err(status, detail) {
  return json({ detail }, status);
}

// Picks the ElevenLabs key for this request.
// 1. A visitor's own key (sent from the browser's "Key settings" dialog).
// 2. Otherwise the site owner's key (ELEVENLABS_API_KEY secret), but only if the
//    visitor knows the ACCESS_CODE (when one is configured).
export function resolveKey(request, env) {
  const own = (request.headers.get("X-ElevenLabs-Key") || "").trim();
  if (own) return { key: own };
  const serverKey = (env.ELEVENLABS_API_KEY || "").trim();
  if (!serverKey) {
    return { error: err(401, "No ElevenLabs key set up. Open Key settings and paste your own ElevenLabs API key.") };
  }
  const code = (env.ACCESS_CODE || "").trim();
  if (code) {
    const given = (request.headers.get("X-Access-Code") || "").trim();
    if (given !== code) {
      return { error: err(401, "This site needs an access code. Open Key settings and enter it, or use your own ElevenLabs key.") };
    }
  }
  return { key: serverKey };
}

export async function elevenError(r) {
  let msg = r.statusText;
  try {
    const d = await r.json();
    const detail = d.detail ?? d;
    msg = typeof detail === "object" ? detail.message || JSON.stringify(detail) : String(detail);
  } catch {}
  return err(r.status, msg);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function roomStub(env, code) {
  if (!env.ROOMS) throw new Error("ROOMS Durable Object binding is missing. Deploy rooms-worker and check wrangler.toml.");
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}
