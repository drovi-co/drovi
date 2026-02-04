import { useMemo, useState } from "react";
import { IntentBar } from "./components/IntentBar";
import { JsonRenderer } from "./components/JsonRenderer";

const SAMPLE_OUTPUT = {
  title: "Executive Daily Brief",
  type: "brief",
  evidence: [
    { id: "evt_1", source: "meeting", snippet: "We committed to deliver by Friday." },
    { id: "evt_2", source: "email", snippet: "Renewal approved pending legal." },
  ],
  timeline: [
    { time: "09:05", label: "Decision", detail: "Ship v2 scope locked" },
    { time: "11:30", label: "Risk", detail: "Vendor dependency slipping" },
  ],
  metrics: {
    open_commitments: 7,
    overdue_commitments: 2,
    risk_score: 0.64,
  },
};

export default function App() {
  const [view, setView] = useState<"intent" | "chat" | "render" | "timeline" | "deck">(
    "intent",
  );

  const output = useMemo(() => SAMPLE_OUTPUT, []);

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__brand">Drovi Shell</div>
        <div className="shell__tabs">
          {[
            { id: "intent", label: "Intent Bar" },
            { id: "chat", label: "Chat" },
            { id: "render", label: "Render" },
            { id: "timeline", label: "Reality Stream" },
            { id: "deck", label: "Command Deck" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={view === tab.id ? "tab tab--active" : "tab"}
              onClick={() => setView(tab.id as typeof view)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="shell__content">
        {view === "intent" && <IntentBar />}
        {view === "chat" && (
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
        {view === "render" && (
          <div className="panel">
            <h2>Rendered Output</h2>
            <JsonRenderer payload={output} />
          </div>
        )}
        {view === "timeline" && (
          <div className="panel">
            <h2>Reality Stream</h2>
            <div className="timeline">
              {output.timeline.map((item) => (
                <div key={item.time} className="timeline__item">
                  <div className="timeline__time">{item.time}</div>
                  <div className="timeline__body">
                    <div className="timeline__label">{item.label}</div>
                    <div className="timeline__detail">{item.detail}</div>
                    <button className="ghost">Show evidence</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {view === "deck" && (
          <div className="panel">
            <h2>Command Deck</h2>
            <div className="deck">
              <div className="deck__card">
                <div className="deck__title">Renewal Guardian</div>
                <div className="deck__meta">Status: active · Risk: medium</div>
                <div className="deck__actions">
                  <button className="primary">Review</button>
                  <button className="ghost">Pause</button>
                </div>
              </div>
              <div className="deck__card">
                <div className="deck__title">Delivery Integrity</div>
                <div className="deck__meta">Status: escalated · Risk: high</div>
                <div className="deck__actions">
                  <button className="primary">Escalate</button>
                  <button className="ghost">Kill</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
