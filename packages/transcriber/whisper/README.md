# Python whisperx transcription service

A Python WebSocket server that transcribes audio with Whisper (via
[`whisperx`](https://github.com/m-bain/whisperX)). No speaker diarization —
speaker attribution is done by the audio source (microphone vs system audio),
which the Node app sends in the `start` message.

It speaks the WebSocket protocol expected by the Node app, so the app and UI
work with it directly. Each transcription includes a `source` field
(`microphone` or `system`), which the UI renders as `[MIC]` or `[Speaker]`.

## Protocol

- On connect, sends: `{ "type": "ready", "model", "sampleRate": 16000 }`
- Receives JSON commands, e.g. `{ "type": "start", "source" }` and
  `{ "type": "clear" }`
- Receives binary PCM16 / mono / 16kHz audio frames
- Sends: `{ "type": "partial", "text", "start", "end", "source" }` for the
  live, still-updating phrase
- Sends: `{ "type": "final", "text", "start", "end", "source" }` when a
  phrase is complete (after a silence gap)
- On error sends: `{ "type": "error", "message" }`

## Setup

### 1. Install Python dependencies

```bash
cd whisper

# Optional but recommended for CPU-only machines (avoids huge CUDA wheels):
pip install torch --index-url https://download.pytorch.org/whl/cpu

pip install -r requirements.txt
```

## Run

```bash
cd whisper
python server.py
```

The first run downloads the Whisper and alignment models (large). Subsequent
runs are fast.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `9000` | Bind port (must match `STT_WS_URL` in the Node app) |
| `MODEL` | `base` | Whisper model size (`tiny`, `base`, `small`, `medium`, `large-v3`) |
| `DEVICE` | `cpu` | `cpu` or `cuda` |
| `COMPUTE_TYPE` | `int8` | `int8`, `float16`, `float32` |
| `WINDOW_SECONDS` | `4` | Rolling window fed to the model (smaller = faster) |
| `TRANSCRIBE_INTERVAL_MS` | `100` | How often the loop attempts inference |
| `MIN_AUDIO_SECONDS` | `0.3` | Minimum buffered audio before inference |
| `VAD_THRESHOLD` | `0.01` | RMS below this is treated as silence |
| `PAUSE_FINALIZE_MS` | `400` | Silence gap (ms) after which a phrase is finalized and shown once |

## Run with the Node app

```bash
# terminal 1: Python whisperx service
cd whisper && python server.py

# terminal 2: Node app + UI (unchanged)
npm run dev
```

Open <http://127.0.0.1:8080>. The Node app connects to the Python service at
`ws://127.0.0.1:9000` (the default `STT_WS_URL`), so no config change is needed.

## Notes

- **Source labels** come from the audio source, not voice diarization. The UI
  shows `[MIC]` for microphone audio and `[Speaker]` for system audio.
- **Pause-based finalization**: a phrase is only committed to the history after
  a silence gap (`PAUSE_FINALIZE_MS`), so it appears once and not mid-sentence.
