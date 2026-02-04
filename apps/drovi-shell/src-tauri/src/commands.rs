use std::process::Command;

use base64::{engine::general_purpose, Engine as _};
use crate::context::{ContextPolicy, ContextSnapshot, ContextState};
use tauri::State;

#[tauri::command]
pub async fn get_active_context(state: State<'_, ContextState>) -> Result<ContextSnapshot, String> {
    let allow_screenshot = state.allow_screenshot();

    #[cfg(target_os = "macos")]
    let (active_app, window_title, open_apps, screenshot_base64) =
        capture_macos_context(allow_screenshot);

    #[cfg(not(target_os = "macos"))]
    let (active_app, window_title, open_apps, screenshot_base64) = (
        Some("Unsupported".to_string()),
        Some("Context capture not available".to_string()),
        Vec::new(),
        None,
    );

    let snapshot = ContextSnapshot {
        active_app,
        window_title,
        selected_text: None,
        ocr_text: None,
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
) -> Result<(), String> {
    state.update_policy(max_bytes, ttl_seconds, allow_screenshot);
    Ok(())
}

#[cfg(target_os = "macos")]
fn capture_macos_context(
    allow_screenshot: bool,
) -> (Option<String>, Option<String>, Vec<String>, Option<String>) {
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

    (active_app, window_title, open_apps, screenshot_base64)
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
