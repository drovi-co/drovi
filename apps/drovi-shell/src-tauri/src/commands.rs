use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use keyring::Entry;
use crate::context::{ContextPolicy, ContextSnapshot, ContextState};
use tauri::State;

const KEYRING_SERVICE: &str = "drovi-shell";

// ============================================================================
// Secure Token Storage Commands
// ============================================================================

/// Store an authentication token securely in the system keychain
#[tauri::command]
pub async fn store_auth_token(token: String, token_type: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &token_type)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry.set_password(&token)
        .map_err(|e| format!("Failed to store token: {}", e))?;

    Ok(())
}

/// Retrieve an authentication token from the system keychain
#[tauri::command]
pub async fn get_auth_token(token_type: String) -> Result<Option<String>, String> {
    let entry = Entry::new(KEYRING_SERVICE, &token_type)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve token: {}", e)),
    }
}

/// Delete a specific authentication token from the system keychain
#[tauri::command]
pub async fn delete_auth_token(token_type: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, &token_type)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted, that's fine
        Err(e) => Err(format!("Failed to delete token: {}", e)),
    }
}

/// Clear all authentication tokens from the system keychain
#[tauri::command]
pub async fn clear_auth_tokens() -> Result<(), String> {
    // List of token types we store
    let token_types = ["session_token", "refresh_token", "access_token"];

    for token_type in token_types {
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, token_type) {
            let _ = entry.delete_credential(); // Ignore errors for non-existent entries
        }
    }

    Ok(())
}

/// Open a URL in the system's default browser (for OAuth flows)
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// Context Capture Commands
// ============================================================================

#[tauri::command]
pub async fn get_active_context(state: State<'_, ContextState>) -> Result<ContextSnapshot, String> {
    let allow_screenshot = state.allow_screenshot();
    let allow_accessibility = state.allow_accessibility();
    let allow_ocr = state.allow_ocr();

    #[cfg(target_os = "macos")]
    let (active_app, window_title, open_apps, screenshot_base64, selected_text, ocr_text) =
        capture_macos_context(allow_screenshot, allow_accessibility, allow_ocr);

    #[cfg(not(target_os = "macos"))]
    let (active_app, window_title, open_apps, screenshot_base64, selected_text, ocr_text) = (
        Some("Unsupported".to_string()),
        Some("Context capture not available".to_string()),
        Vec::new(),
        None,
        None,
        None,
    );

    let snapshot = ContextSnapshot {
        active_app,
        window_title,
        selected_text,
        ocr_text,
        screenshot_base64,
        open_apps,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    state.store_snapshot(snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub async fn toggle_intent_bar(window: tauri::Window) -> Result<(), String> {
    let is_visible = window.is_visible().unwrap_or(false);
    if is_visible {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_context_cache(state: State<'_, ContextState>) -> Result<Vec<ContextSnapshot>, String> {
    Ok(state.list_snapshots())
}

#[tauri::command]
pub async fn update_context_budget(
    state: State<'_, ContextState>,
    max_bytes: usize,
    ttl_seconds: u64,
) -> Result<(), String> {
    state.update_budget(max_bytes, ttl_seconds);
    Ok(())
}

#[tauri::command]
pub async fn get_context_policy(state: State<'_, ContextState>) -> Result<ContextPolicy, String> {
    Ok(state.policy())
}

#[tauri::command]
pub async fn update_context_policy(
    state: State<'_, ContextState>,
    max_bytes: usize,
    ttl_seconds: u64,
    allow_screenshot: bool,
    allow_accessibility: bool,
    allow_ocr: bool,
) -> Result<(), String> {
    state.update_policy(
        max_bytes,
        ttl_seconds,
        allow_screenshot,
        allow_accessibility,
        allow_ocr,
    );
    Ok(())
}

#[tauri::command]
pub async fn clear_context_cache(state: State<'_, ContextState>) -> Result<(), String> {
    state.clear_snapshots();
    Ok(())
}

#[tauri::command]
pub async fn core_request(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    let base_url = std::env::var("DROVI_CORE_URL").unwrap_or_else(|_| "http://localhost:8000".into());
    let api_key = std::env::var("DROVI_CORE_API_KEY").ok();
    let internal_token = std::env::var("DROVI_CORE_INTERNAL_TOKEN").ok();

    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );

    let client = reqwest::Client::new();
    let method_parsed = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut request = client.request(method_parsed, url);

    // Set Content-Type header
    request = request.header("Content-Type", "application/json");

    // Pass through custom headers (including Authorization)
    if let Some(hdrs) = headers {
        for (key, value) in hdrs {
            request = request.header(&key, &value);
        }
    }

    // Set API key and internal token from environment if available
    if let Some(api_key) = api_key {
        request = request.header("X-API-Key", api_key);
    }
    if let Some(token) = internal_token {
        request = request.header("X-Internal-Service-Token", token);
    }

    if let Some(payload) = body {
        request = request.json(&payload);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Core request failed ({}): {}", status, text));
    }

    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn capture_macos_context(
    allow_screenshot: bool,
    allow_accessibility: bool,
    allow_ocr: bool,
) -> (
    Option<String>,
    Option<String>,
    Vec<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let active_app = run_osascript(
        "tell application \"System Events\" to get name of first application process whose frontmost is true",
    );

    let window_title = run_osascript(
        "tell application \"System Events\" to tell (first process whose frontmost is true) to get name of front window",
    );

    let window_id = run_osascript(
        "tell application \"System Events\" to tell (first process whose frontmost is true) to get id of front window",
    );

    let open_apps_raw = run_osascript(
        "tell application \"System Events\" to get name of (application processes where background only is false)",
    );
    let open_apps = open_apps_raw
        .unwrap_or_default()
        .split(", ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let screenshot_base64 = capture_window_screenshot(window_id, allow_screenshot);
    let selected_text = capture_selected_text(allow_accessibility);
    let ocr_text = capture_ocr_text(&screenshot_base64, allow_ocr);

    (
        active_app,
        window_title,
        open_apps,
        screenshot_base64,
        selected_text,
        ocr_text,
    )
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Option<String> {
    let output = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(target_os = "macos")]
fn capture_window_screenshot(window_id: Option<String>, allow_screenshot: bool) -> Option<String> {
    if !allow_screenshot {
        return None;
    }

    let window_id = window_id?.trim().to_string();
    if window_id.is_empty() {
        return None;
    }

    let tmp_path = std::env::temp_dir().join("drovi_context.png");
    let status = Command::new("screencapture")
        .args(["-x", "-l", &window_id, tmp_path.to_str()?])
        .status()
        .ok()?;

    if !status.success() {
        return None;
    }

    let bytes = std::fs::read(&tmp_path).ok()?;
    let _ = std::fs::remove_file(&tmp_path);
    Some(general_purpose::STANDARD.encode(bytes))
}

#[cfg(target_os = "macos")]
fn capture_selected_text(allow_accessibility: bool) -> Option<String> {
    if !allow_accessibility {
        return None;
    }

    let previous = Command::new("pbpaste").output().ok().and_then(|output| {
        if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            None
        }
    });

    let _ = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"c\" using command down")
        .status();

    thread::sleep(Duration::from_millis(120));

    let selected = Command::new("pbpaste").output().ok().and_then(|output| {
        if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        }
    });

    if let Some(previous) = previous {
        if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                let _ = stdin.write_all(previous.as_bytes());
            }
            let _ = child.wait();
        }
    }

    selected.filter(|text| !text.is_empty())
}

#[cfg(target_os = "macos")]
fn capture_ocr_text(screenshot_base64: &Option<String>, allow_ocr: bool) -> Option<String> {
    if !allow_ocr {
        return None;
    }
    let base64 = screenshot_base64.as_ref()?;
    let bytes = general_purpose::STANDARD.decode(base64.as_bytes()).ok()?;

    let tmp_path = std::env::temp_dir().join("drovi_context_ocr.png");
    if std::fs::write(&tmp_path, bytes).is_err() {
        return None;
    }

    let output = Command::new("tesseract")
        .arg(tmp_path.to_str()?)
        .arg("stdout")
        .arg("-l")
        .arg("eng")
        .output()
        .ok();

    let _ = std::fs::remove_file(&tmp_path);

    let output = output?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text.chars().take(2000).collect())
    }
}
