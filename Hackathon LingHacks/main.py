import os
import io
import json
import secrets
import time
import asyncio
import httpx
from pathlib import Path
from typing import Dict, Set
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse, StreamingResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
PUBLIC_DIR = BASE_DIR / "public"   # same files Cloudflare Pages serves
INDEX_HTML = PUBLIC_DIR / "index.html"

app = FastAPI(title="VoiceFlow – Voice Accessibility Tool")
app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR / "static")), name="static")

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"

# ── Credentials ───────────────────────────────────────────────────────────────

def load_api_key() -> str:
    cred_file = BASE_DIR / "credentials.json"
    if cred_file.exists():
        try:
            data = json.loads(cred_file.read_text(encoding="utf-8"))
            key = data.get("elevenlabs_api_key", "").strip()
            if key:
                return key
        except Exception as e:
            raise RuntimeError(f"credentials.json could not be parsed: {e}")
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if key:
        return key
    raise RuntimeError(
        "credentials.json not found next to main.py. "
        'Create it with: {"elevenlabs_api_key": "your-key-here"}'
    )

# The page may send a visitor's own key (Key settings dialog); it wins over credentials.json.
_request_key = __import__("contextvars").ContextVar("request_key", default="")

@app.middleware("http")
async def capture_visitor_key(request: Request, call_next):
    _request_key.set(request.headers.get("x-elevenlabs-key", "").strip())
    return await call_next(request)

def get_headers() -> dict:
    return {"xi-api-key": _request_key.get() or load_api_key()}

# ── Room system ───────────────────────────────────────────────────────────────
# rooms[room_code] = {
#   "token": str,          # secret token only the host knows
#   "created_at": float,
#   "listeners": set[WebSocket],
# }

rooms: Dict[str, dict] = {}
ROOM_TTL = 60 * 60 * 6   # rooms expire after 6 hours
MAX_ROOMS = 500           # cap to avoid memory abuse

def _cleanup_rooms():
    now = time.time()
    expired = [k for k, v in rooms.items() if now - v["created_at"] > ROOM_TTL]
    for k in expired:
        del rooms[k]

def _generate_room_code() -> str:
    """6-char uppercase alphanumeric, avoids ambiguous chars."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))

# ── HTTP routes ───────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(INDEX_HTML)


@app.get("/favicon.ico")
async def favicon():
    return RedirectResponse(url="/static/favicon.svg")

@app.get("/listen", response_class=HTMLResponse)
async def listen_page():
    return FileResponse(INDEX_HTML)

@app.get("/api/status")
async def status():
    if not _request_key.get():
        try:
            load_api_key()
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{ELEVENLABS_BASE}/user", headers=get_headers())
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="ElevenLabs API key is invalid or quota exceeded.")
    data = r.json()
    return {
        "ok": True,
        "name": data.get("first_name", "User"),
        "tier": data.get("subscription", {}).get("tier", "free"),
    }


# ── Room API ──────────────────────────────────────────────────────────────────

@app.post("/api/rooms/create")
async def create_room():
    """Host creates a room. Returns room_code + secret host_token."""
    _cleanup_rooms()
    if len(rooms) >= MAX_ROOMS:
        raise HTTPException(status_code=503, detail="Server at room capacity. Try again later.")
    # Ensure unique code
    for _ in range(20):
        code = _generate_room_code()
        if code not in rooms:
            break
    else:
        raise HTTPException(status_code=503, detail="Could not generate unique room code.")

    host_token = secrets.token_urlsafe(32)
    rooms[code] = {
        "token": host_token,
        "created_at": time.time(),
        "listeners": set(),
    }
    return {"room_code": code, "host_token": host_token}


@app.get("/api/rooms/{code}/exists")
async def room_exists(code: str):
    """Listener checks if a room exists before joining."""
    code = code.upper().strip()
    if code not in rooms:
        raise HTTPException(status_code=404, detail="Room not found or expired.")
    return {"exists": True, "listener_count": len(rooms[code]["listeners"])}


@app.delete("/api/rooms/{code}")
async def close_room(code: str, host_token: str = Query(...)):
    """Host closes their room."""
    code = code.upper().strip()
    room = rooms.get(code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found.")
    if not secrets.compare_digest(room["token"], host_token):
        raise HTTPException(status_code=403, detail="Invalid host token.")
    # Notify all listeners then close
    for ws in list(room["listeners"]):
        try:
            await ws.send_json({"type": "room_closed"})
            await ws.close()
        except Exception:
            pass
    del rooms[code]
    return {"closed": True}


# ── WebSocket: listener ───────────────────────────────────────────────────────

@app.websocket("/ws/listen/{code}")
async def ws_listener(websocket: WebSocket, code: str):
    code = code.upper().strip()
    room = rooms.get(code)
    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return
    await websocket.accept()
    room["listeners"].add(websocket)
    try:
        await websocket.send_json({"type": "joined", "room_code": code})
        # Keep alive — listeners only receive, never send
        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        room["listeners"].discard(websocket)


# ── WebSocket: host broadcasts audio ─────────────────────────────────────────

@app.websocket("/ws/host/{code}")
async def ws_host(websocket: WebSocket, code: str):
    code = code.upper().strip()
    host_token = websocket.query_params.get("host_token", "")
    room = rooms.get(code)
    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return
    if not host_token or not secrets.compare_digest(room["token"], host_token):
        await websocket.close(code=4003, reason="Invalid host token")
        return
    await websocket.accept()
    try:
        while True:
            # Host sends JSON messages; we forward to all listeners
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "speaking":
                # Broadcast text so listeners can see it
                payload = {"type": "speaking", "text": data.get("text", "")}
                for ws in list(room["listeners"]):
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        room["listeners"].discard(ws)

            elif msg_type == "audio_chunk":
                # Host sends base64 audio; broadcast to listeners
                payload = {"type": "audio_chunk", "data": data.get("data", "")}
                for ws in list(room["listeners"]):
                    try:
                        await ws.send_json(payload)
                    except Exception:
                        room["listeners"].discard(ws)

            elif msg_type == "listener_count":
                await websocket.send_json({"type": "listener_count", "count": len(room["listeners"])})

    except WebSocketDisconnect:
        pass


# ── Voice & TTS routes ────────────────────────────────────────────────────────

@app.post("/api/clone-voice")
async def clone_voice(
    voice_name: str = Form(...),
    audio_file: UploadFile = File(...),
):
    audio_bytes = await audio_file.read()
    files = {
        "files": (audio_file.filename or "recording.wav", audio_bytes, audio_file.content_type or "audio/wav"),
        "name": (None, voice_name),
        "description": (None, f"VoiceFlow cloned voice: {voice_name}"),
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(f"{ELEVENLABS_BASE}/voices/add", headers=get_headers(), files=files)
    if r.status_code != 200:
        detail = r.json().get("detail", {})
        msg = detail.get("message", r.text) if isinstance(detail, dict) else str(detail)
        raise HTTPException(status_code=r.status_code, detail=msg)
    return {"voice_id": r.json()["voice_id"], "name": voice_name}


@app.get("/api/voices")
async def list_voices():
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(f"{ELEVENLABS_BASE}/voices", headers=get_headers())
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail="Failed to fetch voices")
    return [
        {"voice_id": v["voice_id"], "name": v["name"], "category": v.get("category", "premade")}
        for v in r.json().get("voices", [])
    ]


class TTSRequest(BaseModel):
    voice_id: str
    text: str
    stability: float = 0.5
    similarity_boost: float = 0.75
    style: float = 0.0


@app.post("/api/tts")
async def text_to_speech(req: TTSRequest):
    payload = {
        "text": req.text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": req.stability,
            "similarity_boost": req.similarity_boost,
            "style": req.style,
            "use_speaker_boost": True,
        },
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(
            f"{ELEVENLABS_BASE}/text-to-speech/{req.voice_id}",
            headers={**get_headers(), "Content-Type": "application/json"},
            json=payload,
        )
    if r.status_code != 200:
        try:
            detail = r.json().get("detail", {})
            msg = detail.get("message", r.text) if isinstance(detail, dict) else str(detail)
        except Exception:
            msg = r.text
        raise HTTPException(status_code=r.status_code, detail=msg)
    return StreamingResponse(
        io.BytesIO(r.content),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )


@app.delete("/api/voices/{voice_id}")
async def delete_voice(voice_id: str):
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.delete(f"{ELEVENLABS_BASE}/voices/{voice_id}", headers=get_headers())
    if r.status_code not in (200, 204):
        raise HTTPException(status_code=r.status_code, detail="Failed to delete voice")
    return {"deleted": True}
