# Drovi Desktop Companion

Electron-based attended execution shell for local AgentOS actions.

## Purpose

- Secure local bridge for file/app actions that cannot be safely delegated to cloud-only tools.
- Human-in-the-loop approval queue for high-risk local actions.
- Local immutable-style audit stream for every action decision and execution outcome.

## Local Run

```bash
bun install
bun --cwd apps/drovi-desktop run dev
```

## Security Environment Variables

- `DROVI_DESKTOP_BRIDGE_MTLS=true|false`
- `DROVI_DESKTOP_BRIDGE_CERT=/path/to/server.crt`
- `DROVI_DESKTOP_BRIDGE_KEY=/path/to/server.key`
- `DROVI_DESKTOP_BRIDGE_CA=/path/to/ca.crt`
- `DROVI_DESKTOP_BRIDGE_BOOTSTRAP_SECRET=...`
- `DROVI_DESKTOP_REMOTE_DISABLE_TOKEN=...`
- `DROVI_DESKTOP_BRIDGE_TOKEN_SECRET=...`
- `DROVI_DESKTOP_ALLOWED_ROOTS=/allowed/one,/allowed/two`
- `DROVI_DESKTOP_ALLOWED_APPS=Microsoft Excel,Microsoft PowerPoint`
- `DROVI_DESKTOP_AUTOMATION_MODE=restricted|unsafe` (default `restricted`)
- `DROVI_DESKTOP_SCREEN_CAPTURE_ENABLED=true|false`
- `DROVI_DESKTOP_SCREEN_CAPTURE_WIDTH=1600`
- `DROVI_DESKTOP_SCREEN_CAPTURE_HEIGHT=1000`
- `DROVI_DESKTOP_SECRET_KEY=...`

## Test

```bash
bun --cwd apps/drovi-desktop run test
```
