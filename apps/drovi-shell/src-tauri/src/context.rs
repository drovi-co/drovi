use serde::{Deserialize, Serialize};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime};

#[derive(Serialize, Deserialize, Clone)]
pub struct ContextSnapshot {
    pub active_app: Option<String>,
    pub window_title: Option<String>,
    pub selected_text: Option<String>,
    pub ocr_text: Option<String>,
    pub screenshot_base64: Option<String>,
    pub open_apps: Vec<String>,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ContextPolicy {
    pub max_bytes: usize,
    pub ttl_seconds: u64,
    pub allow_screenshot: bool,
}

struct StoredSnapshot {
    snapshot: ContextSnapshot,
    byte_size: usize,
    captured_at: SystemTime,
}

pub struct ContextState {
    max_bytes: Mutex<usize>,
    ttl: Mutex<Duration>,
    allow_screenshot: Mutex<bool>,
    snapshots: Mutex<Vec<StoredSnapshot>>,
    current_bytes: Mutex<usize>,
}

impl ContextState {
    pub fn new() -> Self {
        let max_bytes = std::env::var("DROVI_CONTEXT_MAX_BYTES")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(100_000);
        let ttl_seconds = std::env::var("DROVI_CONTEXT_TTL_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(300);
        let allow_screenshot = std::env::var("DROVI_CONTEXT_CAPTURE_SCREENSHOT")
            .ok()
            .map(|v| v.to_lowercase() != "false")
            .unwrap_or(true);

        Self::new_with_config(max_bytes, ttl_seconds, allow_screenshot)
    }

    pub fn new_with_config(max_bytes: usize, ttl_seconds: u64, allow_screenshot: bool) -> Self {
        Self {
            max_bytes: Mutex::new(max_bytes),
            ttl: Mutex::new(Duration::from_secs(ttl_seconds)),
            allow_screenshot: Mutex::new(allow_screenshot),
            snapshots: Mutex::new(Vec::new()),
            current_bytes: Mutex::new(0),
        }
    }

    pub fn policy(&self) -> ContextPolicy {
        ContextPolicy {
            max_bytes: *Self::lock_value(&self.max_bytes),
            ttl_seconds: Self::lock_value(&self.ttl).as_secs(),
            allow_screenshot: *Self::lock_value(&self.allow_screenshot),
        }
    }

    pub fn update_budget(&self, max_bytes: usize, ttl_seconds: u64) {
        *Self::lock_value_mut(&self.max_bytes) = max_bytes;
        *Self::lock_value_mut(&self.ttl) = Duration::from_secs(ttl_seconds);
    }

    pub fn update_policy(&self, max_bytes: usize, ttl_seconds: u64, allow_screenshot: bool) {
        self.update_budget(max_bytes, ttl_seconds);
        *Self::lock_value_mut(&self.allow_screenshot) = allow_screenshot;
    }

    pub fn allow_screenshot(&self) -> bool {
        *Self::lock_value(&self.allow_screenshot)
    }

    pub fn store_snapshot(&self, mut snapshot: ContextSnapshot) {
        let max_bytes = *Self::lock_value(&self.max_bytes);
        let ttl = *Self::lock_value(&self.ttl);

        let mut snapshot_size = Self::snapshot_size(&snapshot);
        if snapshot_size > max_bytes {
            snapshot.screenshot_base64 = None;
            snapshot_size = Self::snapshot_size(&snapshot);
        }
        if snapshot_size > max_bytes {
            return;
        }

        let now = SystemTime::now();
        let mut snapshots = Self::lock_value_mut(&self.snapshots);
        let mut current_bytes = Self::lock_value_mut(&self.current_bytes);

        Self::prune_locked(&mut snapshots, &mut current_bytes, ttl);
        while *current_bytes + snapshot_size > max_bytes {
            if snapshots.is_empty() {
                break;
            }
            if let Some(oldest) = snapshots.first() {
                *current_bytes = current_bytes.saturating_sub(oldest.byte_size);
            }
            snapshots.remove(0);
        }

        snapshots.push(StoredSnapshot {
            snapshot,
            byte_size: snapshot_size,
            captured_at: now,
        });
        *current_bytes += snapshot_size;
    }

    pub fn list_snapshots(&self) -> Vec<ContextSnapshot> {
        let ttl = *Self::lock_value(&self.ttl);
        let mut snapshots = Self::lock_value_mut(&self.snapshots);
        let mut current_bytes = Self::lock_value_mut(&self.current_bytes);
        Self::prune_locked(&mut snapshots, &mut current_bytes, ttl);
        snapshots.iter().map(|entry| entry.snapshot.clone()).collect()
    }

    fn snapshot_size(snapshot: &ContextSnapshot) -> usize {
        serde_json::to_vec(snapshot).map(|v| v.len()).unwrap_or(0)
    }

    fn prune_locked(
        snapshots: &mut Vec<StoredSnapshot>,
        current_bytes: &mut usize,
        ttl: Duration,
    ) {
        let now = SystemTime::now();
        snapshots.retain(|entry| {
            if let Ok(age) = now.duration_since(entry.captured_at) {
                let keep = age <= ttl;
                if !keep {
                    *current_bytes = current_bytes.saturating_sub(entry.byte_size);
                }
                keep
            } else {
                true
            }
        });
    }

    fn lock_value<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|err| err.into_inner())
    }

    fn lock_value_mut<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|err| err.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_snapshot_when_over_budget() {
        let state = ContextState::new_with_config(400, 300, true);
        let snapshot = ContextSnapshot {
            active_app: Some("Test".into()),
            window_title: Some("Window".into()),
            selected_text: None,
            ocr_text: None,
            screenshot_base64: Some("x".repeat(500)),
            open_apps: vec!["Test".into()],
            timestamp: "2026-02-04T00:00:00Z".into(),
        };

        state.store_snapshot(snapshot);
        let stored = state.list_snapshots();
        assert_eq!(stored.len(), 1);
        assert!(stored[0].screenshot_base64.is_none());
    }

    #[test]
    fn updates_policy_values() {
        let state = ContextState::new_with_config(100, 100, true);
        state.update_policy(500, 60, false);
        let policy = state.policy();
        assert_eq!(policy.max_bytes, 500);
        assert_eq!(policy.ttl_seconds, 60);
        assert!(!policy.allow_screenshot);
    }
}
