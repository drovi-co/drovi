from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypeVar

from pydantic import BaseModel

from src.llm.service import LLMCall


T = TypeVar("T", bound=BaseModel)


def _stable_json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def llm_replay_key(payload: dict[str, Any]) -> str:
    """
    Stable key for an LLM call.

    We intentionally do not use the raw prompt as a filename; we hash it so:
    - fixtures are smaller and less sensitive
    - diffs are stable and reviewable
    """
    raw = _stable_json_dumps(payload).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


@dataclass(frozen=True)
class RecordedResponse:
    kind: Literal["text", "json"]
    value: Any


class LLMReplayStore:
    """
    Replay/record store for deterministic tests.

    Format:
    {
      "<sha256>": { "kind": "json", "value": { ... } },
      "<sha256>": { "kind": "text", "value": "..." }
    }
    """

    def __init__(self, path: Path):
        self._path = path
        self._data: dict[str, dict[str, Any]] = {}
        if path.exists():
            self._data = json.loads(path.read_text(encoding="utf-8"))

    def get(self, key: str) -> RecordedResponse | None:
        raw = self._data.get(key)
        if not isinstance(raw, dict):
            return None
        kind = raw.get("kind")
        if kind not in ("text", "json"):
            return None
        return RecordedResponse(kind=kind, value=raw.get("value"))

    def put(self, key: str, response: RecordedResponse) -> None:
        self._data[key] = {"kind": response.kind, "value": response.value}
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(_stable_json_dumps(self._data) + "\n", encoding="utf-8")


class ReplayLLMService:
    """
    Minimal drop-in LLMService replacement for tests.

    Supports the two primary interfaces used in the orchestrator:
    - complete (text)
    - complete_structured (Pydantic)

    When running in replay mode, any missing fixture is a hard failure. This is
    intentional: it forces tests to stay deterministic.
    """

    def __init__(
        self,
        store: LLMReplayStore,
        *,
        mode: Literal["replay", "record"] = "replay",
        default_model: str = "replay-model",
    ):
        self._store = store
        self._mode = mode
        self._default_model = default_model

    async def complete(
        self,
        messages: list[dict[str, str]],
        model_tier: str = "balanced",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout_seconds: float | None = None,
        node_name: str = "unknown",
    ) -> tuple[str, LLMCall]:
        payload = {
            "kind": "complete",
            "messages": messages,
            "model_tier": model_tier,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "timeout_seconds": timeout_seconds,
            "node_name": node_name,
        }
        key = llm_replay_key(payload)
        recorded = self._store.get(key)
        if recorded is None:
            if self._mode != "record":
                raise KeyError(f"Missing LLM replay fixture for key={key} node={node_name}")
            # Record-mode is intentionally simple: tests may explicitly call put().
            recorded = RecordedResponse(kind="text", value="")
            self._store.put(key, recorded)

        if recorded.kind != "text":
            raise TypeError(f"Expected text fixture for key={key}, got {recorded.kind}")

        call = LLMCall(node=node_name, model=self._default_model, provider="replay")
        call.success = True
        return str(recorded.value or ""), call

    async def complete_structured(
        self,
        messages: list[dict[str, str]],
        output_schema: type[T],
        model_tier: str = "balanced",
        temperature: float = 0.0,
        max_tokens: int = 4096,
        timeout_seconds: float | None = None,
        node_name: str = "unknown",
    ) -> tuple[T, LLMCall]:
        payload = {
            "kind": "complete_structured",
            "messages": messages,
            "output_schema": output_schema.__name__,
            "model_tier": model_tier,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "timeout_seconds": timeout_seconds,
            "node_name": node_name,
        }
        key = llm_replay_key(payload)
        recorded = self._store.get(key)
        if recorded is None:
            if self._mode != "record":
                raise KeyError(f"Missing LLM replay fixture for key={key} node={node_name}")
            recorded = RecordedResponse(kind="json", value={})
            self._store.put(key, recorded)

        if recorded.kind != "json":
            raise TypeError(f"Expected json fixture for key={key}, got {recorded.kind}")

        parsed = output_schema.model_validate(recorded.value or {})
        call = LLMCall(node=node_name, model=self._default_model, provider="replay")
        call.success = True
        return parsed, call

