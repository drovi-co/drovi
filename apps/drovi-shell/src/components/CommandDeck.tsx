import { useEffect, useState } from "react";
import { activateContinuum, listContinuums, pauseContinuum, runContinuum } from "../core";

interface ContinuumItem {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  active_version?: number;
  next_run_at?: string | null;
}

interface CommandDeckProps {
  organizationId: string | null;
}

export function CommandDeck({ organizationId }: CommandDeckProps) {
  const [continuums, setContinuums] = useState<ContinuumItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadContinuums = async () => {
    if (!organizationId) {
      setContinuums([]);
      return;
    }
    setLoading(true);
    try {
      const result = (await listContinuums(organizationId)) as ContinuumItem[];
      setContinuums(result ?? []);
      setStatus(null);
    } catch (error) {
      setStatus(`Failed to load Continuums: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContinuums();
  }, [organizationId]);

  const handleRun = async (id: string) => {
    if (!organizationId) return;
    await runContinuum(id, organizationId);
    void loadContinuums();
  };

  const handlePause = async (id: string) => {
    if (!organizationId) return;
    await pauseContinuum(id, organizationId);
    void loadContinuums();
  };

  const handleActivate = async (id: string) => {
    if (!organizationId) return;
    await activateContinuum(id, organizationId);
    void loadContinuums();
  };

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Command Deck</h2>
        <div className="panel__actions">
          <button className="ghost" onClick={loadContinuums} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {!organizationId && (
        <div className="muted">Set an organization ID to load Continuums.</div>
      )}
      {status && <div className="status">{status}</div>}
      <div className="deck">
        {continuums.length === 0 && organizationId && (
          <div className="muted">No Continuums available yet.</div>
        )}
        {continuums.map((continuum) => (
          <div key={continuum.id} className="deck__card">
            <div className="deck__title">{continuum.name}</div>
            <div className="deck__meta">
              Status: {continuum.status} · Version: {continuum.active_version ?? "—"}
            </div>
            {continuum.description && (
              <div className="deck__description">{continuum.description}</div>
            )}
            <div className="deck__meta">
              Next run: {continuum.next_run_at ?? "manual"}
            </div>
            <div className="deck__actions">
              <button className="primary" onClick={() => handleRun(continuum.id)}>
                Run
              </button>
              {continuum.status === "paused" ? (
                <button className="ghost" onClick={() => handleActivate(continuum.id)}>
                  Activate
                </button>
              ) : (
                <button className="ghost" onClick={() => handlePause(continuum.id)}>
                  Pause
                </button>
              )}
              <button className="ghost" onClick={() => handlePause(continuum.id)}>
                Kill
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
