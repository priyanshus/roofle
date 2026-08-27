"""
whisperx-based transcription (no speaker diarization).

Wraps whisperx to transcribe a rolling audio window and align word-level
timestamps. Speaker attribution is handled upstream by the audio source
(microphone vs system audio), so no diarization models or HF token are needed.

The service receives a rolling window of audio (Float32, 16kHz mono) plus an
absolute timeline offset (in seconds) so that whisperx's relative timestamps
can be mapped back to the overall audio timeline.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

import numpy as np

# whisperx is imported lazily so the module can be imported (and the server
# started) even before whisperx is installed.
_whisperx = None


def _load_whisperx():
    global _whisperx
    if _whisperx is None:
        import whisperx  # type: ignore

        _whisperx = whisperx
    return _whisperx


@dataclass
class Segment:
    """A transcribed segment with an audio-aligned time range."""

    text: str
    start: float  # seconds, absolute audio timeline
    end: float  # seconds, absolute audio timeline


class Transcriber:
    """Transcribes rolling audio windows with whisperx (no diarization)."""

    def __init__(
        self,
        model_name: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
    ) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type

        self._model = None
        self._align_model = None
        self._metadata = None

    def load(self) -> None:
        """Load the Whisper and alignment models once."""
        wx = _load_whisperx()

        print(f"Loading Whisper model: {self.model_name} ({self.device}, {self.compute_type})")
        self._model = wx.load_model(
            self.model_name,
            device=self.device,
            compute_type=self.compute_type,
        )

        print("Loading alignment model...")
        self._align_model, self._metadata = wx.load_align_model(
            language_code="en",
            device=self.device,
        )
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
        if self._model is None or self._align_model is None:
            raise RuntimeError("Transcriber.load() must be called before use")

        wx = _load_whisperx()

        result = self._model.transcribe(
            audio,
            batch_size=16,
            language="en",
        )

        result = wx.align(
            result["segments"],
            self._align_model,
            self._metadata,
            audio,
            device=self.device,
            return_char_alignments=False,
        )

        segments: List[Segment] = []
        for seg in result["segments"]:
            text = (seg.get("text") or "").strip()
            if not text:
                continue

            start = offset_sec + float(seg.get("start", 0.0))
            end = offset_sec + float(seg.get("end", 0.0))
            segments.append(Segment(text=text, start=start, end=end))

        return segments
