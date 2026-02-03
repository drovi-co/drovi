"""Speaker diarization adapter (optional pyannote)."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass

import structlog

logger = structlog.get_logger()


@dataclass
class DiarizationSegment:
    start_ms: int
    end_ms: int
    speaker_label: str


def diarize_audio_bytes(data: bytes) -> list[DiarizationSegment]:
    """Return diarization segments. Falls back to single speaker if unavailable."""
    try:
        from pyannote.audio import Pipeline  # type: ignore
    except Exception:
        return [DiarizationSegment(start_ms=0, end_ms=0, speaker_label="Speaker 1")]

    try:
        from src.config import get_settings

        settings = get_settings()
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization",
            use_auth_token=settings.pyannote_auth_token,
        )
    except Exception as exc:
        logger.warning("Diarization model unavailable", error=str(exc))
        return [DiarizationSegment(start_ms=0, end_ms=0, speaker_label="Speaker 1")]

    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(data)
        tmp.flush()

        diarization = pipeline(tmp.name)

    segments: list[DiarizationSegment] = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            DiarizationSegment(
                start_ms=int(turn.start * 1000),
                end_ms=int(turn.end * 1000),
                speaker_label=str(speaker),
            )
        )

    if not segments:
        return [DiarizationSegment(start_ms=0, end_ms=0, speaker_label="Speaker 1")]

    return segments
