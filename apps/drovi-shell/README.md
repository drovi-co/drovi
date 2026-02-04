# Drovi Shell

Cross‑platform desktop shell for the Intent Substrate.

**Goals**
- Global Intent Bar (Spotlight‑grade overlay).
- Reality Stream and Command Deck surfaces.
- Live context capture from active apps with consent.

**Architecture**
- Tauri v2 for cross‑platform shell.
- Rust Core handles context capture, local caching, encryption, IPC.
- Swift macOS modules for Accessibility + ScreenCaptureKit integration.
- React UI for rapid iteration and JSON‑rendered outputs.

**Context Capture Plan**
- Active app metadata + selected text (Accessibility API).
- Focused window capture with explicit consent.
- OCR for non‑text surfaces.
- Context budget enforcement and time‑based expiration.

**Security**
- Per‑app permissions and visible capture indicators.
- Local redaction pipeline before cloud sync.
- All context flows through Proof Core for evidence anchoring.

