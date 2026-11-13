# VoiceFlow: Voice Accessibility Tool

VoiceFlow clones your voice from a short recording, then lets you type anything
and have it spoken aloud in your own voice. It also includes Live Rooms, so
someone else can hear you speak in real time without watching a chat window.

No account is required. The app runs locally on your computer using your own
ElevenLabs API key.

---

## Put it online (Cloudflare Pages)

The `public/` folder is the website and `functions/` is a small serverless API
that talks to ElevenLabs for you. Live Rooms run in a Cloudflare Durable Object
that lives in `rooms-worker/`. Everything fits in Cloudflare's free plan.

> Drag-and-drop upload in the Cloudflare dashboard does **not** include the
> `functions/` folder, so the app would load but nothing would work. Use one of
> the two ways below.

### One-time setup

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Install [Node.js](https://nodejs.org) (LTS), then in this folder run:
   ```bash
   npm install
   npx wrangler login
   ```
3. Deploy the Live Rooms worker (do this first, the site links to it):
   ```bash
   npm run deploy:rooms
   ```

### Way A: deploy from your computer

```bash
npm run deploy
```

The first time, Wrangler asks to create a project called `voiceflow`. Say yes.
You get a URL like `https://voiceflow.pages.dev`.

### Way B: auto-deploy from GitHub

In the dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick
this repo, and set:

| Setting | Value |
|---|---|
| Root directory | `Hackathon LingHacks` |
| Build command | *(leave empty)* |
| Build output directory | `public` |

Every push to `main` then redeploys. (Still run `npm run deploy:rooms` once.)

### Add your ElevenLabs key (secret)

Never put your real key in `credentials.json` on GitHub. Store it in Cloudflare:

```bash
npx wrangler pages secret put ELEVENLABS_API_KEY --project-name voiceflow
npx wrangler pages secret put ACCESS_CODE --project-name voiceflow
```

`ACCESS_CODE` is optional but strongly recommended: without it, anyone who
finds your URL can spend your ElevenLabs credits and see or delete your voices.
Visitors enter the code (or their own ElevenLabs key) with the key button in
the top-right of the page. Run `npm run deploy` again after changing secrets.

If you set no `ELEVENLABS_API_KEY` at all, the site still works: every visitor
just pastes their own key in Key settings.

### Test the online version on your computer

```bash
npm run dev:rooms
```
then in a second terminal:
```bash
npm run dev
```
and open `http://localhost:8787`. Put local secrets in a file called
`.dev.vars` (already git-ignored):
```
ELEVENLABS_API_KEY=sk_your_key
ACCESS_CODE=pick-a-code
```

---

## Run it locally with Python instead

## 1. Install Python

You need Python 3.10 or newer.

- Check if it's already installed by opening a terminal and running:
  ```bash
  python --version
  ```
  or on Mac/Linux:
  ```bash
  python3 --version
  ```
- If it's not installed, download it from [python.org/downloads](https://www.python.org/downloads/).
  On Windows, make sure to check the box that says **"Add Python to PATH"** during installation.

A debugger isn't required to run the app, but if you're using VS Code, the
built-in Python debugger (Run and Debug panel) works fine for stepping through
`main.py`.

---

## 2. Install the requirements

Open a terminal in the project folder (the one containing `main.py`) and run:

```bash
pip install -r requirements.txt
```

If `pip` isn't recognized, try `pip3` or `python -m pip install -r requirements.txt`.

---

## 3. Add your ElevenLabs API key

Create a file named `credentials.json` in the same folder as `main.py`
(if `credentials.json.example` exists, copy it and rename the copy):

```json
{
  "elevenlabs_api_key": "sk-your-key-here"
}
```

Replace `sk-your-key-here` with your real key from
[elevenlabs.io](https://elevenlabs.io) under **Profile → API Key**.

ONLY PAID ElevenLabs account works, STARTER tier is recommended (it includes
Instant Voice Cloning).

---

## 4. Run the app

In the same terminal, run:

```bash
uvicorn main:app --reload --port 8080
```

You should see something like:

```
INFO:     Uvicorn running on http://127.0.0.1:8080 (Press CTRL+C to quit)
INFO:     Application startup complete.
```

---

## 5. Open it in your browser

Go to:

```
http://localhost:8080
```

The connection pill in the top right should turn green once your API key is
verified. From there:

1. **Step 1: Clone Voice**, record at least one minute of speech (or upload
   a file with at least a minute of audio).
2. **Step 2: Speak & Share**, pick your voice, type something, and press
   **Speak**. Open a **Live Room** to let someone else listen in real time.

---

## Troubleshooting

### "Address already in use" or `[WinError 10013]` when starting the server

Port 8080 (or whatever port you chose) is already being used by something
else. Try a different port:

```bash
uvicorn main:app --reload --port 8090
```

Then open `http://localhost:8090` instead. On Windows, you can check what's
using a port with:

```bash
netstat -ano | findstr :8080
```

### `index.html` not found / page won't load

The `public` folder is missing or in the wrong place. Your folder must
look like this:

```
your-project-folder/
├── main.py              (local Python server)
├── credentials.json     (local only, keep your real key out of git)
├── requirements.txt
├── wrangler.toml        (Cloudflare Pages config)
├── public/              (the website, served by both)
│   ├── index.html
│   └── static/favicon.svg
├── functions/           (Cloudflare API)
└── rooms-worker/        (Cloudflare Live Rooms)
```

Make sure `index.html` is inside a folder literally named `public`,
sitting next to `main.py`.

### The connection pill stays grey or shows "Not connected"

This means `credentials.json` wasn't found or the key inside it isn't valid.
Check that:

- `credentials.json` is in the same folder as `main.py` (not inside
  `public`)
- The file contains valid JSON, with double quotes around both the key name
  and the value
- The API key itself is correct and hasn't been revoked

### `ModuleNotFoundError: No module named 'fastapi'` (or similar)

The requirements weren't installed into the Python environment you're running
with. Re-run:

```bash
pip install -r requirements.txt
```

If you're using a virtual environment, make sure it's activated first.

### Microphone recording doesn't work

Browsers only allow microphone access on `localhost` or over HTTPS. Make sure
you're visiting `http://localhost:8080` (not your computer's IP address), and
allow the microphone permission prompt when it appears.

### Voice cloning fails with a message about audio length

VoiceFlow requires at least 1 minute (60 seconds) of audio. The page shows you
how long your recording or uploaded file is. Record a bit more, or upload a
longer file, and try again.

### Live Room: listener doesn't hear anything

1. The person listening needs to tap anywhere on the page once after it
   loads. Browsers block audio from playing automatically until there's been
   some interaction with the page; this only needs to happen once.
2. Make sure the host hasn't closed the room (the "Room open" badge should
   still be visible on the host's screen).
3. Both people need to be able to reach the same server address. If you're
   testing on one computer, two browser tabs both pointing at
   `http://localhost:8080` works fine. If you're sharing with someone on a
   different device, you'll need to host the app somewhere reachable by both
   (see **Put it online** above) rather than relying on `localhost`.

---

## Notes

- Your API key is read directly from `credentials.json` on the server and is
  never sent to the browser.
- Quick-phrase buttons, full keyboard navigation, ARIA labels, and a
  light/dark theme toggle are built in for accessibility.
- `Ctrl+Enter` in the text box triggers Speak.