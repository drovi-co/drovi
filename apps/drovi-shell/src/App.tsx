import { useEffect, useMemo, useState, useCallback } from "react";
import { IntentBar } from "./components/IntentBar";
import { JsonRenderer } from "./components/JsonRenderer";
import { RealityStream } from "./components/RealityStream";
import { CommandDeck } from "./components/CommandDeck";
import { CommandPalette } from "./components/CommandPalette";
import { ConnectionsGallery } from "./components/Connections";
import { ContinuumsList } from "./components/Continuums";
import { ActuationsList } from "./components/Actuations";
import { AuthProvider, LoginScreen, useAuth } from "./components/Auth";
import { useOrgId } from "./store/authStore";
import { Settings } from "./components/Settings";
import { Onboarding } from "./components/Onboarding";
import { DetailPanel } from "./components/DetailPanel";
import { BriefView } from "./components/BriefView";
import { EvidenceLens } from "./components/EvidenceLens";
import { analyzeIntent } from "./core";
import { useUIStore, type ViewType } from "./store/uiStore";
import { useSSE } from "./realtime";

const SAMPLE_OUTPUT = {
  title: "Executive Daily Brief",
  type: "brief",
  narrative:
    "Momentum held steady. Two commitments completed, one risk escalated due to vendor delay.",
  evidence: [
    {
      id: "evt_1",
      source: "meeting",
      snippet: "We committed to deliver by Friday.",
      timestamp: "09:05",
    },
    {
      id: "evt_2",
      source: "email",
      snippet: "Renewal approved pending legal.",
      timestamp: "10:40",
    },
  ],
  timeline: [
    {
      time: "09:05",
      label: "Decision",
      detail: "Ship v2 scope locked",
      evidence: [{ source: "meeting", snippet: "Shipping v2 scope locked." }],
    },
    {
      time: "11:30",
      label: "Risk",
      detail: "Vendor dependency slipping",
      evidence: [{ source: "email", snippet: "Vendor slip confirmed for Friday." }],
    },
  ],
  metrics: {
    open_commitments: 7,
    overdue_commitments: 2,
    risk_score: 0.64,
  },
  table: [
    { item: "Renewal Q2", owner: "A. Perez", status: "At risk" },
    { item: "Launch Partner", owner: "M. Ito", status: "On track" },
  ],
  chart: {
    labels: ["Risk", "Delivery", "Renewal"],
    values: [0.6, 0.35, 0.8],
  },
  locations: [
    { name: "New York", lat: 40.7, lon: -74.0 },
    { name: "London", lat: 51.5, lon: -0.1 },
  ],
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  // Auth state
  const { isAuthenticated, isLoading } = useAuth();
  const authOrgId = useOrgId();

  // UI Store for view management
  const { activeView, setActiveView } = useUIStore();

  const [windowLabel, setWindowLabel] = useState("main");

  // Use org from auth store, fallback to localStorage for backwards compat
  const organizationId = authOrgId || localStorage.getItem("drovi_org_id");

  // Onboarding state
  const [onboardingComplete, setOnboardingComplete] = useState(() => {
    return localStorage.getItem("drovi_onboarding_complete") === "true";
  });

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
  }, []);

  // Real-time updates via SSE
  useSSE(organizationId);
  const [output, setOutput] = useState<Record<string, unknown>>(SAMPLE_OUTPUT);
  const [structuredView, setStructuredView] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const renderPayload = useMemo(() => output ?? SAMPLE_OUTPUT, [output]);

  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!isTauri) {
      return;
    }
    import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) => {
        const label = getCurrentWebviewWindow().label;
        setWindowLabel(label);
      })
      .catch(() => undefined);
  }, []);

  const handleIntentSubmit = async ({
    mode,
    content,
  }: {
    mode: string;
    content: string;
  }) => {
    if (!organizationId) {
      setStatus("Set an organization ID first.");
      return;
    }
    setStatus(`Running ${mode} intent...`);
    try {
      const result = (await analyzeIntent({
        content,
        organization_id: organizationId,
      })) as Record<string, unknown>;
      const summary = {
        title: "Intent Output",
        type: "analysis",
        narrative: "Structured extraction completed.",
        metrics: {
          commitments: Array.isArray(result.commitments) ? result.commitments.length : 0,
          decisions: Array.isArray(result.decisions) ? result.decisions.length : 0,
          risks: Array.isArray(result.risks) ? result.risks.length : 0,
        },
        table: result.commitments ?? [],
        evidence: result.risks ?? [],
        raw: result,
      };
      setOutput(summary);
      setStatus("Intent complete.");
    } catch (error) {
      setStatus(`Core request failed: ${String(error)}`);
      setOutput(SAMPLE_OUTPUT);
    }
  };

  // Intent bar window doesn't require auth
  if (windowLabel === "intent_bar") {
    return (
      <div className="shell shell--intent">
        <IntentBar
          activeView="Intent Bar"
          onSubmit={handleIntentSubmit}
          organizationId={organizationId}
        />
      </div>
    );
  }

  // Show loading state while checking session
  if (isLoading) {
    return (
      <div className="shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="command-palette__loading">
          <div className="command-palette__spinner" style={{ width: 24, height: 24, border: "2px solid var(--color-border)", borderTopColor: "var(--color-accent)", borderRadius: "50%" }} />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Show onboarding for new users
  if (!onboardingComplete) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__brand">Drovi Shell</div>
        {organizationId && (
          <div className="shell__org-badge">
            <span className="shell__org-id">{organizationId}</span>
          </div>
        )}
        <div className="shell__tabs">
          {[
            { id: "brief", label: "Brief" },
            { id: "intent", label: "Intent Bar" },
            { id: "chat", label: "Chat" },
            { id: "render", label: "Render" },
            { id: "timeline", label: "Reality Stream" },
            { id: "deck", label: "Command Deck" },
            { id: "continuums", label: "Continuums" },
            { id: "actuations", label: "Actuations" },
            { id: "connections", label: "Connections" },
            { id: "settings", label: "Settings" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={activeView === tab.id ? "tab tab--active" : "tab"}
              onClick={() => setActiveView(tab.id as ViewType)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="shell__content">
        {activeView === "brief" && <BriefView />}
        {activeView === "intent" && (
          <IntentBar
            activeView="Intent"
            onSubmit={handleIntentSubmit}
            organizationId={organizationId}
          />
        )}
        {activeView === "chat" && (
          <div className="panel">
            <h2>Dialogue</h2>
            <p>Chat is optional. The primary output remains structured truth.</p>
            <div className="chat">
              <div className="chat__bubble chat__bubble--user">What changed since yesterday?</div>
              <div className="chat__bubble">
                2 commitments completed, 1 decision made, 1 risk escalated.
              </div>
            </div>
          </div>
        )}
        {activeView === "render" && (
          <div className="panel">
            <div className="panel__header">
              <h2>Rendered Output</h2>
              <div className="panel__actions">
                <button
                  className={structuredView ? "pill pill--active" : "pill"}
                  onClick={() => setStructuredView(true)}
                >
                  Structured
                </button>
                <button
                  className={!structuredView ? "pill pill--active" : "pill"}
                  onClick={() => setStructuredView(false)}
                >
                  Narrative
                </button>
              </div>
            </div>
            {structuredView ? (
              <JsonRenderer payload={renderPayload} />
            ) : (
              <div className="narrative">
                {(renderPayload.narrative as string) ??
                  "Narrative view will summarize structured reality."}
              </div>
            )}
          </div>
        )}
        {activeView === "timeline" && (
          <RealityStream
            timeline={(renderPayload.timeline as any[]) ?? []}
            evidence={(renderPayload.evidence as any[]) ?? []}
          />
        )}
        {activeView === "deck" && <CommandDeck organizationId={organizationId} />}
        {activeView === "continuums" && <ContinuumsList />}
        {activeView === "actuations" && <ActuationsList organizationId={organizationId} />}
        {activeView === "connections" && <ConnectionsGallery />}
        {activeView === "settings" && <Settings />}
      </main>

      {/* Command Palette - Global */}
      <CommandPalette />

      {/* Detail Panel - Slide-out */}
      <DetailPanel />

      {/* Evidence Lens - Modal */}
      <EvidenceLens />

      {status && <div className="shell__status">{status}</div>}
    </div>
  );
}
