# Drovi Recorder (macOS)

Minimal SwiftUI + Menu Bar recorder for Drovi live ingestion.

## Setup
1. Create a new macOS App in Xcode named `DroviRecorder`.
2. Replace generated Swift files with the ones in this folder.
3. Update `Config.swift` with your API base URL, org ID, and API key.
4. Enable microphone permission in entitlements.

## Notes
- This version records microphone audio to a local file, uploads on stop.
- Real-time chunk streaming is next (background chunk uploads).
