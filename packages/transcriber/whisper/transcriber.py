"""
mlx-whisper based transcription (Apple Silicon / MLX).

Wraps `mlx_whisper.transcribe` to transcribe a rolling audio window and return
segment-level timestamps. Speaker attribution is handled upstream by the audio
source (microphone vs system audio), so no diarization is needed.

The service receives a rolling window of audio (Float32, 16kHz mono) plus an
absolute timeline offset (in seconds) so that mlx-whisper's relative timestamps
can be mapped back to the overall audio timeline.

mlx-whisper downloads an MLX-converted Whisper model from the Hugging Face Hub
on first use (e.g. `mlx-community/whisper-large-v3-turbo`), or loads a local
MLX model directory.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import numpy as np

# mlx_whisper is imported lazily so the module can be imported (and the server
# started) even before mlx_whisper is installed.
_mlx_whisper = None


def _load_mlx_whisper():
    global _mlx_whisper
    if _mlx_whisper is None:
        import mlx_whisper  # type: ignore

        _mlx_whisper = mlx_whisper
    return _mlx_whisper


@dataclass
class Segment:
    """A transcribed segment with an audio-aligned time range."""

    text: str
    start: float  # seconds, absolute audio timeline
    end: float  # seconds, absolute audio timeline


class Transcriber:
    """Transcribes rolling audio windows with mlx-whisper (no diarization)."""

    def __init__(
        self,
        model_name: str = "mlx-community/whisper-large-v3-turbo",
        device: str = "mps",
        compute_type: str = "float16",
    ) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type

        # mlx-whisper runs natively on Apple silicon; the device is always the
        # MLX device. `fp16` enables half-precision (best on M-series); set it
        # to False for float32 when needed for accuracy/debugging.
        self.fp16 = compute_type.lower() in ("float16", "fp16", "int8", "int4")

    def load(self) -> None:
        """Resolve and warm up the MLX model once.

        mlx-whisper downloads the model on first call to `transcribe`, so this
        method pre-downloads it (via a tiny no-op transcription of silence) so
        the interactive latency on the first real segment is not dominated by a
        large model download.
        """
        _load_mlx_whisper()

        print(f"Loading Whisper model: {self.model_name} ({self.device}, {self.compute_type})")

        # Warm the model cache with a small slice of silence. 30s of zeros is
        # the smallest window mlx-whisper is designed to process; we discard
        # the result but force the HF weights to download and load once.
        silence = np.zeros(30 * 16000, dtype=np.float32)
        try:
            _load_mlx_whisper().transcribe(
                silence,
                path_or_hf_repo=self.model_name,
                fp16=self.fp16,
                language="en",
                verbose=None,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"Warm-up transcription failed (model may still load lazily): {exc}")

        print("Models loaded")

    def transcribe(
        self,
        audio: np.ndarray,
        offset_sec: float,
    ) -> List[Segment]:
        """
        Transcribe a rolling audio window.

        Args:
            audio: Float32 mono audio at 16kHz.
            offset_sec: absolute time (seconds) at which `audio` begins in the
                overall audio timeline.

        Returns:
            A list of Segments with absolute timestamps.
        """
        if not audio.size:
            return []

        result = _load_mlx_whisper().transcribe(
            audio,
            path_or_hf_repo=self.model_name,
            fp16=self.fp16,
            language="en",
            verbose=None,
            word_timestamps=False,
            condition_on_previous_text=False,
        )

        segments: List[Segment] = []
        for seg in result.get("segments", []):
            text = (seg.get("text") or "").strip()
            if not text:
                continue

            start = offset_sec + float(seg.get("start", 0.0))
            end = offset_sec + float(seg.get("end", 0.0))
            segments.append(Segment(text=text, start=start, end=end))

        return segments
