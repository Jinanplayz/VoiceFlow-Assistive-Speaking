# EchoAble – Assistive Voice Technology

AI-powered voice cloning web app built for people who can't speak for long durations.
Clone your voice from a short sample, then use Text-to-Speech to communicate naturally.

## Setup

```bash
# 1. Add your API key
cp credentials.json.example credentials.json
# Edit credentials.json and replace with your real ElevenLabs API key

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run
uvicorn main:app --reload --port 8000

# 4. Open browser
# http://localhost:8000
```

## Credentials

Place a `credentials.json` file in the project root:

```json
{
  "elevenlabs_api_key": "sk-your-key-here"
}
```

The server reads the key automatically — no login screen needed.
Fallback: set the `ELEVENLABS_API_KEY` environment variable instead.

## Accessibility features

- Short recordings accepted (even 10 seconds works)
- Quick-phrase buttons for one-tap common phrases
- Full keyboard navigation (Tab, Enter, Space)
- ARIA labels and live regions throughout
- Large tap targets for motor impairment
- Ctrl+Enter shortcut to generate TTS quickly

## Workflow

1. **Clone Voice** — Record in browser or upload an existing audio file
2. **Speak with TTS** — Select your cloned voice, type (or tap a quick phrase), generate audio
