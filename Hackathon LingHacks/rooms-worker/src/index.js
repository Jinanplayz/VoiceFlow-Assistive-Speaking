// VoiceFlow Live Rooms: one Durable Object per room code.
// The Pages site binds to this class (see ../wrangler.toml), so this worker
// must be deployed once before the Pages site can open rooms.
import { DurableObject } from "cloudflare:workers";

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // rooms expire after 6 hours

export class RoomDO extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init") {
      if (await this.ctx.storage.get("token")) return new Response("taken", { status: 409 });
      const { token } = await request.json();
      await this.ctx.storage.put("token", token);
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response("ok");
    }

    const token = await this.ctx.storage.get("token");
    if (!token) return jsonRes({ detail: "Room not found or expired." }, 404);

    if (path === "/exists") {
      return jsonRes({ exists: true, listener_count: this.ctx.getWebSockets("listener").length });
    }

    const given = url.searchParams.get("host_token") || "";

    if (path === "/close") {
      if (!safeEqual(given, token)) return jsonRes({ detail: "Invalid host token." }, 403);
      await this.shutdown();
      return jsonRes({ closed: true });
    }

    if (path === "/host" || path === "/listen") {
      if (path === "/host" && !safeEqual(given, token)) {
        return new Response("Invalid host token", { status: 403 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [path === "/host" ? "host" : "listener"]);
      if (path === "/listen") server.send(JSON.stringify({ type: "joined" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws, message) {
    if (!this.ctx.getTags(ws).includes("host")) return; // listeners only receive
    let data;
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); }
    catch { return; }

    if (data.type === "speaking" || data.type === "audio_chunk") {
      const payload = data.type === "speaking"
        ? JSON.stringify({ type: "speaking", text: String(data.text || "") })
        : JSON.stringify({ type: "audio_chunk", data: String(data.data || "") });
      for (const l of this.ctx.getWebSockets("listener")) {
        try { l.send(payload); } catch {}
      }
    } else if (data.type === "listener_count") {
      ws.send(JSON.stringify({ type: "listener_count", count: this.ctx.getWebSockets("listener").length }));
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }

  async alarm() {
    await this.shutdown();
  }

  async shutdown() {
    for (const ws of this.ctx.getWebSockets("listener")) {
      try { ws.send(JSON.stringify({ type: "room_closed" })); ws.close(1000, "Room closed"); } catch {}
    }
    for (const ws of this.ctx.getWebSockets("host")) {
      try { ws.close(1000, "Room closed"); } catch {}
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  fetch() {
    return new Response("VoiceFlow rooms worker is running. Open the Pages site instead.", { status: 200 });
  },
};
