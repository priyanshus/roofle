"""
Python whisperx WebSocket server (no speaker diarization).

Transcribes audio streamed from the Node app. Speaker attribution is done by
the audio source (microphone vs system audio), which the Node app sends in the
`start` message. Each connection is bound to one source, so every partial/final
message carries that source's label.

Protocol:
  - On connect, sends: { "type": "ready", "model", "sampleRate" }
  - Receives JSON commands, e.g. { "type": "start", "source" } and
    { "type": "clear" }
  - Receives binary PCM16 / mono / 16kHz audio frames
  - Sends: { "type": "partial", "text", "start", "end", "source" } for the
    live, still-updating phrase
  - Sends: { "type": "final", "text", "start", "end", "source" } when a
    segment is complete (after a silence gap)
  - On error sends: { "type": "error", "message" }

Latency tuning:
  - WINDOW_SECONDS: rolling window fed to the model (smaller = faster).
  - TRANSCRIBE_INTERVAL_MS: how often the loop attempts inference.
  - MIN_AUDIO_SECONDS: minimum buffered audio before inference runs.
  - VAD_THRESHOLD: RMS below this is treated as silence and skipped.
  - PAUSE_FINALIZE_MS: silence gap after which a segment is finalized.
  - Never starts a new inference while one is still running (overlap guard).
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Optional

import numpy as np
import websockets

from transcriber import Transcriber

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "9000"))
MODEL = os.environ.get("MODEL", "base")
DEVICE = os.environ.get("DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("COMPUTE_TYPE", "int8")

SAMPLE_RATE = 16000

# --- Latency tuning knobs -------------------------------------------------
# A smaller rolling window makes each inference faster, so partials keep up
# with real-time speech instead of lagging behind a growing backlog.
WINDOW_SECONDS = float(os.environ.get("WINDOW_SECONDS", "4"))
# How often the loop attempts inference. Lower = snappier partials.
TRANSCRIBE_INTERVAL_MS = int(os.environ.get("TRANSCRIBE_INTERVAL_MS", "100"))
# Minimum buffered audio before inference runs. Lower = earlier first partial.
MIN_AUDIO_SECONDS = float(os.environ.get("MIN_AUDIO_SECONDS", "0.3"))
VAD_THRESHOLD = float(os.environ.get("VAD_THRESHOLD", "0.01"))
# Silence gap (ms) after which a segment is treated as a complete utterance.
# Lower = finals (committed sentences) appear sooner after a pause.
PAUSE_FINALIZE_MS = int(os.environ.get("PAUSE_FINALIZE_MS", "400"))


class Session:
    """Accumulates incoming PCM16 samples and exposes a rolling Float32 buffer."""

    def __init__(self) -> None:
        self.audio = np.zeros(0, dtype=np.float32)
        # Absolute sample index at which the current buffer begins.
        self.start_offset = 0

    def add_pcm(self, data: bytes) -> None:
        if not data:
            return
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        if samples.size == 0:
            return
        self.audio = np.concatenate([self.audio, samples])

    def get_audio(self) -> np.ndarray:
        return self.audio

    def get_start_offset(self) -> int:
        return self.start_offset

    def clear(self) -> None:
        self.audio = np.zeros(0, dtype=np.float32)
        self.start_offset = 0

    def trim_to_max(self, max_samples: int) -> None:
        if self.audio.size > max_samples:
            dropped = self.audio.size - max_samples
            self.audio = self.audio[dropped:]
            self.start_offset += dropped


def has_speech(audio: np.ndarray) -> bool:
    if audio.size == 0:
        return False
    rms = float(np.sqrt(np.mean(audio**2)))
    return rms >= VAD_THRESHOLD


def delta_words(prev: str, new: str) -> str:
    """Return the words in `new` not already present at the end of `prev`.

    Streaming ASR re-transcribes the same rolling window, so the same segment
    text is produced repeatedly. Only the newly appended words are returned so
    the client can build one continuous paragraph without duplicates.
    """
    prev_words = prev.split()
    new_words = new.split()
    overlap = 0
    for n in range(min(len(prev_words), len(new_words)), 0, -1):
        if prev_words[-n:] == new_words[:n]:
            overlap = n
            break
    return " ".join(new_words[overlap:])


class ClientHandler:
    """Handles a single WebSocket client: buffer, transcribe, finalize, send."""

    def __init__(self, ws, transcriber: Transcriber) -> None:
        self.ws = ws
        self.transcriber = transcriber
        self.session = Session()
        self.source = "unknown"
        # Audio timeline offset (seconds) up to which segments are finalized.
        # Position-based dedup is robust to the model re-decoding the same
        # audio with slightly different text or timestamps.
        self.committed_end = 0.0
        # The active (in-progress) segment: (start_key, sent_text, start, end).
        self.active = None
        self.transcribing = False
        self.loop = asyncio.get_event_loop()

    async def send_json(self, obj: dict) -> None:
        await self.ws.send(json.dumps(obj))

    async def run(self) -> None:
        await self.send_json({"type": "ready", "model": MODEL, "sampleRate": SAMPLE_RATE})

        async def transcription_loop():
            while True:
                await asyncio.sleep(TRANSCRIBE_INTERVAL_MS / 1000.0)
                if self.transcribing:
                    continue
                if self.session.get_audio().size == 0:
                    continue

                self.session.trim_to_max(int(SAMPLE_RATE * WINDOW_SECONDS))

                self.transcribing = True
                try:
                    await self._transcribe()
                except Exception as exc:  # noqa: BLE001
                    print(f"Transcription error: {exc}")
                    await self.send_json({"type": "error", "message": str(exc)})
                finally:
                    self.transcribing = False

        loop_task = asyncio.create_task(transcription_loop())

        try:
            async for message in self.ws:
                if isinstance(message, bytes):
                    self.session.add_pcm(message)
                else:
                    await self._handle_command(message)
        finally:
            loop_task.cancel()

    async def _handle_command(self, raw: str) -> None:
        try:
            command = json.loads(raw)
        except json.JSONDecodeError:
            return

        cmd_type = command.get("type")
        if cmd_type == "start":
            self.source = command.get("source") or "unknown"
        elif cmd_type == "clear":
            self.session.clear()
            self.committed_end = 0.0
            self.active = None

    async def _transcribe(self) -> None:
        audio = self.session.get_audio()
        minimum_samples = int(SAMPLE_RATE * MIN_AUDIO_SECONDS)
        if audio.size < minimum_samples:
            return
        if not has_speech(audio):
            return

        window_samples = int(SAMPLE_RATE * WINDOW_SECONDS)
        if audio.size > window_samples:
            audio = audio[-window_samples:]

        offset_sec = self.session.get_start_offset() / SAMPLE_RATE

        segments = await self.loop.run_in_executor(
            None,
            lambda: self.transcriber.transcribe(audio, offset_sec),
        )

        if not segments:
            return

        # Only consider segments that have not been finalized yet. Position-based
        # (start time) dedup is robust to the model re-decoding the same audio
        # with slightly different text.
        latest = None
        for seg in segments:
            if seg.start >= self.committed_end - 0.05:
                latest = seg
        if latest is None:
            return

        text = latest.text.strip()
        if not text:
            return

        start_key = round(latest.start, 1)

        # Only the words not already sent for this segment are new.
        sent_text = ""
        if self.active is not None and self.active[0] == start_key:
            sent_text = self.active[1]
        delta = delta_words(sent_text, text)
        if not delta:
            # No new words; keep the segment active but do not re-send.
            self.active = (start_key, text, latest.start, latest.end)
            return

        self.active = (start_key, text, latest.start, latest.end)
        await self.send_json(
            {
                "type": "partial",
                "text": delta,
                "start": latest.start,
                "end": latest.end,
                "source": self.source,
            }
        )

        # Track the active segment and schedule finalization after a pause.
        self.loop.call_later(
            PAUSE_FINALIZE_MS / 1000.0,
            lambda: self._finalize_if_still_active(start_key, text, latest.start, latest.end),
        )

    def _finalize_if_still_active(self, start_key, text, start, end) -> None:
        # Only finalize if this segment is still the active one (i.e. no newer
        # speech replaced it). This prevents finalizing a phrase that is still
        # being extended.
        if self.active is None or self.active[0] != start_key:
            return

        self.active = None
        # Advance the committed offset so this segment is never re-emitted.
        self.committed_end = max(self.committed_end, end)

        # The final carries the complete sentence so a downstream consumer
        # (e.g. Kafka/DB) can store it as spoken without accumulating deltas.
        asyncio.ensure_future(
            self.send_json(
                {
                    "type": "final",
                    "text": text,
                    "start": start,
                    "end": end,
                    "source": self.source,
                }
            )
        )


async def main() -> None:
    print("Loading models (this may download on first run)...")
    transcriber = Transcriber(
        model_name=MODEL,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )
    transcriber.load()
    print(f"Starting whisperx WebSocket server on {HOST}:{PORT}")

    async with websockets.serve(
        lambda ws: _handle(ws, transcriber),
        HOST,
        PORT,
        max_size=None,
    ):
        await asyncio.Future()  # run forever


async def _handle(ws, transcriber: Transcriber) -> None:
    handler = ClientHandler(ws, transcriber)
    await handler.run()


if __name__ == "__main__":
    asyncio.run(main())
