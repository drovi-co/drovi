import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

interface ContextSnapshot {
  active_app?: string | null;
  window_title?: string | null;
  selected_text?: string | null;
  ocr_text?: string | null;
  screenshot_base64?: string | null;
  open_apps: string[];
  timestamp: string;
}

interface ContextPolicy {
  max_bytes: number;
  ttl_seconds: number;
  allow_screenshot: boolean;
}

const DEFAULT_POLICY: ContextPolicy = {
  max_bytes: 100_000,
  ttl_seconds: 300,
  allow_screenshot: true,
};

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export function IntentBar() {
  const [mode, setMode] = useState<"ask" | "act" | "build" | "inspect">("ask");
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [cacheCount, setCacheCount] = useState(0);
  const [policy, setPolicy] = useState<ContextPolicy>(DEFAULT_POLICY);
  const [pendingPolicy, setPendingPolicy] = useState<ContextPolicy>(DEFAULT_POLICY);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const contextTags = useMemo(() => {
    if (!context) {
      return [];
    }
    const tags: string[] = [];
    if (context.active_app) {
      tags.push(`Active: ${context.active_app}`);
    }
    if (context.window_title) {
      tags.push(`Window: ${context.window_title}`);
    }
    if (context.open_apps?.length) {
      tags.push(`Open Apps: ${context.open_apps.length}`);
    }
    if (context.screenshot_base64) {
      tags.push("Screenshot cached");
    }
    if (context.timestamp) {
      const timestamp = new Date(context.timestamp);
      tags.push(`Captured: ${timestamp.toLocaleTimeString()}`);
    }
    return tags;
  }, [context]);

  useEffect(() => {
    if (!isTauri) {
      setStatus("Context capture is available in the Drovi Shell desktop app.");
      return;
    }
    void loadPolicy();
    void refreshContext();
  }, []);

  const loadPolicy = async () => {
    try {
      const current = await invoke<ContextPolicy>("get_context_policy");
      setPolicy(current);
      setPendingPolicy(current);
    } catch (error) {
      setStatus(`Failed to load context policy: ${String(error)}`);
    }
  };

  const refreshContext = async () => {
    if (!isTauri) {
      return;
    }
    setLoading(true);
    try {
      const snapshot = await invoke<ContextSnapshot>("get_active_context");
      setContext(snapshot);
      const cache = await invoke<ContextSnapshot[]>("get_context_cache");
      setCacheCount(cache.length);
      setStatus("Context refreshed.");
    } catch (error) {
      setStatus(`Context capture failed: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const applyPolicy = async () => {
    if (!isTauri) {
      return;
    }
    try {
      await invoke("update_context_policy", {
        max_bytes: pendingPolicy.max_bytes,
        ttl_seconds: pendingPolicy.ttl_seconds,
        allow_screenshot: pendingPolicy.allow_screenshot,
      });
      setPolicy(pendingPolicy);
      setStatus("Privacy budgets updated.");
    } catch (error) {
      setStatus(`Failed to update budgets: ${String(error)}`);
    }
  };

  const maxBytesKb = Math.max(1, Math.round(pendingPolicy.max_bytes / 1024));

  return (
    <div className="intent">
      <div className="intent__modes">
        {[
          { id: "ask", label: "Ask" },
          { id: "act", label: "Act" },
          { id: "build", label: "Build" },
          { id: "inspect", label: "Inspect" },
        ].map((item) => (
          <button
            key={item.id}
            className={mode === item.id ? "pill pill--active" : "pill"}
            onClick={() => setMode(item.id as typeof mode)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="intent__input">
        <input
          type="text"
          placeholder="Tell Drovi what you want to happen"
          aria-label="Intent input"
        />
        <button className="primary">Run</button>
      </div>

      <div className="intent__context">
        {contextTags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
        {cacheCount > 0 && <span className="chip">Cache: {cacheCount}</span>}
        <span className="chip chip--ghost">Context Loom active</span>
      </div>

      <div className="intent__privacy">
        <div className="privacy__title">Capture Controls</div>
        <div className="privacy__fields">
          <label className="privacy__row">
            <span>Max cache (KB)</span>
            <input
              type="number"
              min={10}
              step={10}
              value={maxBytesKb}
              onChange={(event) =>
                setPendingPolicy((prev) => ({
                  ...prev,
                  max_bytes: Number(event.target.value) * 1024,
                }))
              }
            />
          </label>
          <label className="privacy__row">
            <span>TTL (seconds)</span>
            <input
              type="number"
              min={30}
              step={30}
              value={pendingPolicy.ttl_seconds}
              onChange={(event) =>
                setPendingPolicy((prev) => ({
                  ...prev,
                  ttl_seconds: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="privacy__row privacy__row--toggle">
            <span>Allow screenshots</span>
            <input
              type="checkbox"
              checked={pendingPolicy.allow_screenshot}
              onChange={(event) =>
                setPendingPolicy((prev) => ({
                  ...prev,
                  allow_screenshot: event.target.checked,
                }))
              }
            />
          </label>
        </div>
        <div className="privacy__actions">
          <button className="ghost" onClick={refreshContext} disabled={loading}>
            {loading ? "Capturing..." : "Refresh context"}
          </button>
          <button
            className="primary"
            onClick={applyPolicy}
            disabled={
              pendingPolicy.max_bytes === policy.max_bytes &&
              pendingPolicy.ttl_seconds === policy.ttl_seconds &&
              pendingPolicy.allow_screenshot === policy.allow_screenshot
            }
          >
            Apply budgets
          </button>
        </div>
        {status && <div className="privacy__status">{status}</div>}
      </div>
    </div>
  );
}
