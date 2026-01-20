# Memorystack Desktop App Setup

This document covers the setup required for building and releasing the Memorystack desktop application.

## Development

### Prerequisites

1. **Rust** - Install via [rustup](https://rustup.rs/)
2. **Bun** - Install via [bun.sh](https://bun.sh/)
3. **Platform-specific dependencies**:

   **macOS:**
   ```bash
   xcode-select --install
   ```

   **Linux (Ubuntu/Debian):**
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
     libwebkit2gtk-4.1-dev \
     libappindicator3-dev \
     librsvg2-dev \
     patchelf \
     libgtk-3-dev
   ```

   **Windows:**
   - Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### Running in Development

```bash
# From the project root
cd apps/web

# Install dependencies
bun install

# Run the desktop app in development mode
bun run desktop:dev
```

### Building for Production

```bash
# Build the desktop app
bun run desktop:build
```

The built artifacts will be in `apps/web/src-tauri/target/release/bundle/`.

## Release Setup

### GitHub Secrets

The following secrets must be configured in GitHub for the release workflow:

#### Required for Auto-Updates

1. **TAURI_SIGNING_PRIVATE_KEY** - The contents of `~/.tauri/memorystack.key`
2. **TAURI_SIGNING_PRIVATE_KEY_PASSWORD** - `memorystack-dev-key` (or your chosen password)

**Keys have been generated!** The signing keys are located at:
- Private key: `~/.tauri/memorystack.key` (Keep this secret!)
- Public key: `~/.tauri/memorystack.key.pub`

The public key has already been added to `tauri.conf.json`.

To set up GitHub secrets:
```bash
# Copy private key contents to clipboard (macOS)
cat ~/.tauri/memorystack.key | pbcopy

# Then paste as TAURI_SIGNING_PRIVATE_KEY secret in GitHub
# Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD to: memorystack-dev-key
```

To regenerate keys (if needed):
```bash
cd apps/web
bun tauri signer generate -p "your-password" -w ~/.tauri/memorystack.key --ci -f
```

#### macOS Code Signing & Notarization

1. **APPLE_CERTIFICATE** - Base64-encoded .p12 certificate
2. **APPLE_CERTIFICATE_PASSWORD** - Password for the certificate
3. **APPLE_SIGNING_IDENTITY** - Certificate name (e.g., "Developer ID Application: Your Company (XXXXXXXXXX)")
4. **APPLE_ID** - Apple ID email for notarization
5. **APPLE_PASSWORD** - App-specific password for notarization
6. **APPLE_TEAM_ID** - Your Apple Developer Team ID

To encode your certificate:
```bash
base64 -i certificate.p12 | pbcopy
```

#### Windows Code Signing

1. **WINDOWS_CERTIFICATE** - Base64-encoded .pfx certificate
2. **WINDOWS_CERTIFICATE_PASSWORD** - Password for the certificate

To encode your certificate:
```bash
base64 -i certificate.pfx > certificate.txt
```

### Triggering a Release

#### Via Git Tag

```bash
# Create and push a version tag
git tag v0.1.0
git push origin v0.1.0
```

#### Via GitHub Actions UI

1. Go to Actions → Desktop Release
2. Click "Run workflow"
3. Enter the version number (e.g., `0.1.0`)
4. Click "Run workflow"

### Update Manifest

The auto-updater uses a JSON manifest to check for updates. The workflow generates this automatically and uploads it as a release artifact.

Update the `endpoints` in `tauri.conf.json` if you want to host the manifest elsewhere:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://your-domain.com/desktop/update-manifest.json"
      ],
      "pubkey": "YOUR_PUBLIC_KEY"
    }
  }
}
```

## Features

### System Tray

The app includes a system tray with:
- Show/Hide window
- Check for updates
- Quit application

### Deep Links

The app registers the `memorystack://` URL scheme. Example links:
- `memorystack://thread/123` - Open a specific thread
- `memorystack://settings` - Open settings

### Global Shortcuts

Global shortcuts can be registered via the `useGlobalShortcut` hook:

```tsx
import { useGlobalShortcut } from "~/hooks/use-tauri";

function MyComponent() {
  useGlobalShortcut("CmdOrCtrl+Shift+M", () => {
    // Handle shortcut
  });
}
```

### Notifications

Native notifications can be sent via the `useNotifications` hook:

```tsx
import { useNotifications } from "~/hooks/use-tauri";

function MyComponent() {
  const { sendNotification } = useNotifications();

  const handleSomething = async () => {
    await sendNotification("Title", "Body text");
  };
}
```

### Auto-Updates

The `AutoUpdaterDialog` component handles update notifications automatically. Add it to your root layout:

```tsx
import { AutoUpdaterDialog } from "~/components/desktop/auto-updater";

function RootLayout() {
  return (
    <>
      <AutoUpdaterDialog />
      {/* ... rest of your app */}
    </>
  );
}
```

## Architecture

```
apps/web/
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # Main Tauri setup
│   │   └── main.rs         # Entry point
│   ├── capabilities/
│   │   └── default.json    # Permission capabilities
│   ├── icons/              # App icons
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri configuration
│   └── entitlements.plist  # macOS sandbox entitlements
├── src/
│   ├── hooks/
│   │   └── use-tauri.ts    # Tauri feature hooks
│   ├── components/
│   │   └── desktop/
│   │       └── auto-updater.tsx
│   └── lib/
│       └── platform.ts     # Platform detection
```

## Troubleshooting

### Build Fails on macOS

If you see webkit-related errors, ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

### Build Fails on Linux

Install the required system dependencies:
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
```

### Deep Links Not Working

1. Ensure the app is built and installed (not just running in dev mode)
2. Check that the URL scheme is registered in `tauri.conf.json`
3. On macOS, you may need to re-register the app with Launch Services:
   ```bash
   /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/Memorystack.app
   ```

### Auto-Updates Not Working

1. Verify the public key in `tauri.conf.json` matches the private key used for signing
2. Check that the update manifest URL is accessible
3. Ensure the app is signed (updates require signed builds)
