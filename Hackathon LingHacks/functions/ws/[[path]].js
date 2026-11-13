// /ws/host/CODE?host_token=...  and  /ws/listen/CODE
// Forwards the WebSocket upgrade to the room's Durable Object.
import { err, roomStub } from "../_lib.js";

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const [role, rawCode] = parts;
  if (!["host", "listen"].includes(role) || !rawCode) return err(404, "Not found");
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return err(426, "Expected a WebSocket upgrade");
  }
  const url = new URL(request.url);
  const target = `https://room/${role}?host_token=${encodeURIComponent(url.searchParams.get("host_token") || "")}`;
  return roomStub(env, rawCode.toUpperCase().trim()).fetch(new Request(target, request));
}
