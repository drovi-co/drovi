import type { ApiHealthResponse, ApiMetaResponse } from "@memorystack/imperium-api-types";

const bootstrapHealth: ApiHealthResponse = {
  status: "ok",
  service: "imperium-api",
};

const bootstrapMeta: ApiMetaResponse = {
  name: "imperium-api",
  version: "0.1.0",
  environment: "development",
  data_mode: "synthetic",
  providers: [
    {
      domain: "markets",
      primary: "polygon",
      fallbacks: ["finnhub", "twelvedata"],
      configured: false,
      required_credentials: ["POLYGON_API_KEY"],
    },
    {
      domain: "crypto",
      primary: "coinbase",
      fallbacks: ["coingecko"],
      configured: false,
      required_credentials: ["COINBASE_API_KEY", "COINBASE_API_SECRET"],
    },
    {
      domain: "news",
      primary: "benzinga",
      fallbacks: ["newsapi", "sec-rss"],
      configured: false,
      required_credentials: ["BENZINGA_API_KEY"],
    },
    {
      domain: "banking",
      primary: "plaid",
      fallbacks: ["truelayer"],
      configured: false,
      required_credentials: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    },
    {
      domain: "brokerage",
      primary: "snaptrade",
      fallbacks: ["alpaca"],
      configured: false,
      required_credentials: ["SNAPTRADE_CLIENT_ID", "SNAPTRADE_CONSUMER_KEY"],
    },
    {
      domain: "business",
      primary: "stripe",
      fallbacks: ["quickbooks", "polar"],
      configured: false,
      required_credentials: ["STRIPE_SECRET_KEY"],
    },
  ],
};

const modules = [
  "Daily Brief",
  "Markets",
  "Portfolio",
  "Business Command",
  "Intelligence Inbox",
  "Risk + Regime",
  "Decision Journal",
];

export function ImperiumApp() {
  return (
    <main className="imperium-shell">
      <section className="imperium-header">
        <p className="kicker">Imperium</p>
        <h1>Sovereign Command Terminal</h1>
        <p className="subhead">
          Phase 1 scaffold live. Backend and realtime modules will be enabled phase by phase.
        </p>
      </section>

      <section className="imperium-grid" aria-label="Imperium modules">
        {modules.map((module) => (
          <article className="imperium-card" key={module}>
            <h2>{module}</h2>
            <p>Service contract and UI flow wiring in progress.</p>
          </article>
        ))}
      </section>

      <section className="imperium-footer" aria-label="Runtime status">
        <div>
          <span>Status</span>
          <strong>{bootstrapHealth.status}</strong>
        </div>
        <div>
          <span>Service</span>
          <strong>{bootstrapHealth.service}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{bootstrapMeta.version}</strong>
        </div>
      </section>
    </main>
  );
}
