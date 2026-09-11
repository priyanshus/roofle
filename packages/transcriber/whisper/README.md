# Python mlx-whisper transcription service

A Python WebSocket server that transcribes audio with Whisper on Apple silicon
via [`mlx-whisper`](https://github.com/ml-explore/mlx-examples/tree/main/whisper)
(MLX-converted models from the Hugging Face Hub). No speaker diarization —
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

## Requirements

- **Apple silicon (M-series)** — mlx-whisper runs on the MLX engine. It does
  not run on Intel/CPU or CUDA the way whisperx did.
- Python 3.9+.

## Setup

### 1. Install Python dependencies

```bash
cd whisper

pip install -r requirements.txt
```

This installs `mlx-whisper` (which pulls in `mlx`) and downloads the model
weights from the Hugging Face Hub on first run.

## Run

```bash
cd whisper
python server.py
```

The first run downloads the Whisper model (large). Subsequent runs are fast.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `9000` | Bind port (must match `STT_WS_URL` in the Node app) |
| `MODEL` | `mlx-community/whisper-large-v3-turbo` | MLX Whisper HF repo (or local MLX model dir), e.g. `mlx-community/whisper-large-v3` |
| `DEVICE` | `mps` | Device for inference (Apple silicon) |
| `COMPUTE_TYPE` | `float16` | `float16` or `float32` |
| `WINDOW_SECONDS` | `4` | Rolling window fed to the model (smaller = faster) |
| `TRANSCRIBE_INTERVAL_MS` | `100` | How often the loop attempts inference |
| `MIN_AUDIO_SECONDS` | `0.3` | Minimum buffered audio before inference |
| `VAD_THRESHOLD` | `0.01` | RMS below this is treated as silence |
| `PAUSE_FINALIZE_MS` | `400` | Silence gap (ms) after which a phrase is finalized and shown once |

## Run with the Node app

```bash
# terminal 1: Python mlx-whisper service
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
- **Model**: transcription is hardcoded to English (`language="en"`).
