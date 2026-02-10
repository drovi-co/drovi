# LLM Replay Fixtures

This directory holds deterministic LLM fixtures for tests.

Why:
- All tests must be deterministic (no network, no provider drift).
- Replay fixtures make it possible to test multi-pass extraction and verification
  logic without calling a real model.

How:
- Store fixtures in JSON keyed by a stable sha256 of the call payload.
- Tests can use `ReplayLLMService` from `tests/fixtures/llm/replay.py`.

Notes:
- Do not store full sensitive prompts unless necessary.
- Prefer short, synthetic prompts for unit tests. For end-to-end snapshot tests,
  keep payload sizes reasonable and redact secrets.

