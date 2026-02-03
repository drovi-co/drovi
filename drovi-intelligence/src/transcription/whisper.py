"""Whisper transcription adapter (local, via faster-whisper if installed)."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from typing import Iterable

import structlog

from src.config import get_settings

logger = structlog.get_logger()


@dataclass
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None = None


def _require_whisper():
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError(
            "Whisper backend is not installed. Add 'faster-whisper' and its dependencies."
        ) from exc
    return WhisperModel


def transcribe_audio_bytes(
    data: bytes,
    language: str | None = None,
    suffix: str = ".wav",
) -> Iterable[TranscriptSegment]:
    """Transcribe audio bytes to segments using Whisper."""
    settings = get_settings()
    WhisperModel = _require_whisper()

    model = WhisperModel(
        settings.whisper_model_size,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )

    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()

        segments, _info = model.transcribe(tmp.name, language=language)

        for seg in segments:
            yield TranscriptSegment(
                start_ms=int(seg.start * 1000),
                end_ms=int(seg.end * 1000),
                text=seg.text.strip(),
                confidence=getattr(seg, "avg_logprob", None),
            )
