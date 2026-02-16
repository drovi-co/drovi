import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import type {
  ApiAuditEventsResponse,
  ApiDeadLetterResponse,
  ApiMetaResponse,
  ApiProvidersHealthResponse,
  ApiProvidersResponse,
  ReplayDeadLetterResponse,
} from "@memorystack/imperium-api-types";

type ModuleKey =
  | "brief"
  | "markets"
  | "portfolio"
  | "business"
  | "intelligence"
  | "risk"
  | "journal"
  | "ops";

interface DailyBriefView {
  brief_id: string;
  brief_date: string;
  generated_at: string;
  required_reads: string[];
  sections: BriefSectionView[];
}

interface BriefSectionView {
  section_key: string;
  title: string;
  summary: string;
  claims: BriefClaimView[];
}

interface BriefClaimView {
  statement: string;
  impact_score: number;
  confidence_score: number;
  citations: BriefCitationView[];
  recommended_action: string | null;
}

interface BriefCitationView {
  source_url: string;
  source_snippet: string;
}

interface SinceLastView {
  items: string[];
}

interface MarketWatchlistItemView {
  symbol: string;
  label: string;
}

interface MarketQuoteView {
  symbol: string;
  price: number;
  change_percent: number;
  volume: number;
  timestamp: string;
}

interface CandleView {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  start_time: string;
  end_time: string;
}

interface PortfolioOverviewView {
  as_of: string;
  net_worth: number;
  daily_change: number;
  ytd_change: number;
  risk_score: number;
  accounts: PortfolioAccountView[];
  top_positions: PortfolioPositionView[];
  exposures: ExposureView[];
}

interface PortfolioAccountView {
  account_id: string;
  name: string;
  account_type: string;
  balance: number;
}

interface PortfolioPositionView {
  symbol: string;
  quantity: number;
  market_value: number;
  asset_class: string;
}

interface ExposureView {
  bucket: string;
  weight_percent: number;
}

interface BusinessOverviewView {
  as_of: string;
  entity_name: string;
  mrr: number;
  burn: number;
  runway_months: number;
  cash_balance: number;
  overdue_invoices: number;
}

interface BusinessMetricView {
  key: string;
  value: number;
  window: string;
}

interface BusinessAnomalyView {
  metric_key: string;
  severity: string;
  message: string;
  recommended_action: string;
}

interface InboxItemView {
  cluster_key: string;
  title: string;
  summary: string;
  impact_score: number;
  source_count: number;
  canonical_url: string;
}

interface StoryClusterView {
  cluster_key: string;
  title: string;
  article_count: number;
  canonical_url: string;
  impact_score: number;
}

interface RegimeStateView {
  regime: string;
  confidence: number;
  explanation: string;
  updated_at: string;
}

interface RiskSignalView {
  key: string;
  severity: string;
  description: string;
  created_at: string;
}

interface MacroIndicatorView {
  key: string;
  value: number;
  change: number;
  updated_at: string;
}

interface ScenarioSimulationResponse {
  scenario_name: string;
  estimated_loss: number;
  liquidity_impact: number;
  hedge_notional: number;
}

interface AlertRuleView {
  rule_id: string;
  category: string;
  name: string;
  threshold: number;
  cooldown_seconds: number;
  enabled: boolean;
}

interface ReminderView {
  thesis_id: string;
  title: string;
  review_date: string;
}

interface StreamContractView {
  channel: string;
  subject: string;
  payload_schema: string;
}

interface ThesisView {
  thesis_id: string;
  title: string;
  position: string;
  conviction_percent: number;
  rationale: string;
  invalidation_criteria: string;
  review_date: string;
  created_at: string;
}

interface PlaybookView {
  playbook_id: string;
  title: string;
  trigger: string;
  response_steps: string[];
  enabled: boolean;
  created_at: string;
}

interface AlertEventView {
  alert_id: string;
  category: string;
  title: string;
  what_happened: string;
  why_it_matters: string;
  what_to_watch_next: string;
  dedupe_key: string;
  created_at: string;
}

interface SessionIssueResponse {
  token: string;
  session_id: string;
  user_id: string;
  device_id: string;
  expires_at: string;
}

interface SessionRefreshResponse {
  token: string;
  session_id: string;
  expires_at: string;
}

interface MarketTickStreamEvent {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
}

const IMPERIUM_SESSION_STORAGE_KEY = "imperium.session.token";
const IMPERIUM_SESSION_EXP_STORAGE_KEY = "imperium.session.expires_at";
const IMPERIUM_DEVICE_STORAGE_KEY = "imperium.session.device_id";

const MODULES: Array<{
  key: ModuleKey;
  label: string;
  shortcut: string;
  description: string;
}> = [
  {
    key: "brief",
    label: "Daily Brief",
    shortcut: "1",
    description: "05:00 decision-grade intelligence in 3 minutes.",
  },
  {
    key: "markets",
    label: "Markets",
    shortcut: "2",
    description: "Live prices, candles, levels, and watchlist heat.",
  },
  {
    key: "portfolio",
    label: "Portfolio",
    shortcut: "3",
    description: "Net worth, exposure, and concentration truth.",
  },
  {
    key: "business",
    label: "Business",
    shortcut: "4",
    description: "Revenue, burn, runway, and anomaly command.",
  },
  {
    key: "intelligence",
    label: "Intelligence",
    shortcut: "5",
    description: "Narrative clusters and ranked must-read queue.",
  },
  {
    key: "risk",
    label: "Risk + Regime",
    shortcut: "6",
    description: "Regime confidence and portfolio risk signals.",
  },
  {
    key: "journal",
    label: "Journal",
    shortcut: "7",
    description: "Decision memory and playbook state.",
  },
  {
    key: "ops",
    label: "Ops",
    shortcut: "8",
    description: "Provider health, DLQ replay, immutable audit feed.",
  },
];

const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "1d"];

function buildHeaders(token: string | null | undefined, withJson = false): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const trimmed = token?.trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
  }

  if (withJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function fetchJson<T>(path: string, token?: string | null): Promise<T> {
  return fetch(path, {
    headers: buildHeaders(token),
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }

    return (await response.json()) as T;
  });
}

function postJson<T>(
  path: string,
  body?: unknown,
  token?: string | null
): Promise<T> {
  return fetch(path, {
    method: "POST",
    headers: buildHeaders(token, body !== undefined),
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    if (!response.ok) {
      const raw = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${raw}`);
    }

    return (await response.json()) as T;
  });
}

function readError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatLargeCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  const signed = value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  return `${signed}%`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }).format(date);
}

function buildSparklinePoints(candles: CandleView[]): string {
  if (candles.length === 0) {
    return "";
  }

  const closes = candles.map((candle) => candle.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const spread = max - min || 1;

  return closes
    .map((close, index) => {
      const x = (index / Math.max(candles.length - 1, 1)) * 100;
      const y = 100 - ((close - min) / spread) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function marketTickFromStream(value: unknown): MarketTickStreamEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const symbol = value.symbol;
  const price = value.price;
  const volume = value.volume;
  const timestamp = value.timestamp;

  if (
    typeof symbol !== "string" ||
    typeof price !== "number" ||
    typeof volume !== "number" ||
    typeof timestamp !== "string"
  ) {
    return null;
  }

  return { symbol, price, volume, timestamp };
}

function alertFromStream(value: unknown): AlertEventView | null {
  if (!isRecord(value)) {
    return null;
  }

  const alert_id = value.alert_id;
  const category = value.category;
  const title = value.title;
  const what_happened = value.what_happened;
  const why_it_matters = value.why_it_matters;
  const what_to_watch_next = value.what_to_watch_next;
  const dedupe_key = value.dedupe_key;
  const created_at = value.created_at;

  if (
    typeof alert_id !== "string" ||
    typeof category !== "string" ||
    typeof title !== "string" ||
    typeof what_happened !== "string" ||
    typeof why_it_matters !== "string" ||
    typeof what_to_watch_next !== "string" ||
    typeof dedupe_key !== "string" ||
    typeof created_at !== "string"
  ) {
    return null;
  }

  return {
    alert_id,
    category,
    title,
    what_happened,
    why_it_matters,
    what_to_watch_next,
    dedupe_key,
    created_at,
  };
}

export function ImperiumApp() {
  const [sessionToken, setSessionToken] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(IMPERIUM_SESSION_STORAGE_KEY) ?? "";
  });
  const [sessionExpiresAt, setSessionExpiresAt] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(IMPERIUM_SESSION_EXP_STORAGE_KEY) ?? "";
  });
  const [deviceId, setDeviceId] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    const existing = window.localStorage.getItem(IMPERIUM_DEVICE_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const generated = `imperium-web-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(IMPERIUM_DEVICE_STORAGE_KEY, generated);
    return generated;
  });

  const [activeModule, setActiveModule] = useState<ModuleKey>("brief");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("SPY");
  const [selectedInterval, setSelectedInterval] = useState("5m");
  const [replayingEventId, setReplayingEventId] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [adminMode, setAdminMode] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return new URLSearchParams(window.location.search).get("admin") === "1";
  });
  const [marketStreamState, setMarketStreamState] = useState("connecting");
  const [alertStreamState, setAlertStreamState] = useState("connecting");

  const [meta, setMeta] = useState<ApiMetaResponse | null>(null);
  const [providers, setProviders] = useState<ApiProvidersResponse | null>(null);
  const [providerHealth, setProviderHealth] = useState<ApiProvidersHealthResponse | null>(null);
  const [brief, setBrief] = useState<DailyBriefView | null>(null);
  const [sinceLast, setSinceLast] = useState<SinceLastView | null>(null);
  const [watchlist, setWatchlist] = useState<MarketWatchlistItemView[]>([]);
  const [quotes, setQuotes] = useState<Record<string, MarketQuoteView>>({});
  const [candles, setCandles] = useState<CandleView[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioOverviewView | null>(null);
  const [businessOverview, setBusinessOverview] = useState<BusinessOverviewView | null>(null);
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetricView[]>([]);
  const [businessAnomalies, setBusinessAnomalies] = useState<BusinessAnomalyView[]>([]);
  const [inbox, setInbox] = useState<InboxItemView[]>([]);
  const [clusters, setClusters] = useState<StoryClusterView[]>([]);
  const [activeInboxKey, setActiveInboxKey] = useState<string | null>(null);
  const [regime, setRegime] = useState<RegimeStateView | null>(null);
  const [indicators, setIndicators] = useState<MacroIndicatorView[]>([]);
  const [riskSignals, setRiskSignals] = useState<RiskSignalView[]>([]);
  const [theses, setTheses] = useState<ThesisView[]>([]);
  const [reminders, setReminders] = useState<ReminderView[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookView[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRuleView[]>([]);
  const [alerts, setAlerts] = useState<AlertEventView[]>([]);
  const [portfolioAccounts, setPortfolioAccounts] = useState<PortfolioAccountView[]>([]);
  const [scenarioResult, setScenarioResult] = useState<ScenarioSimulationResponse | null>(null);
  const [scenarioPending, setScenarioPending] = useState(false);
  const [streamContracts, setStreamContracts] = useState<StreamContractView[]>([]);
  const [dlq, setDlq] = useState<ApiDeadLetterResponse | null>(null);
  const [audit, setAudit] = useState<ApiAuditEventsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authToken = sessionToken.trim() || null;

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        const matched = MODULES.find((module) => module.shortcut === key);
        if (matched) {
          event.preventDefault();
          setActiveModule(matched.key);
        }
      }

      if (key === "escape") {
        setCommandOpen(false);
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (sessionToken.trim()) {
      window.localStorage.setItem(IMPERIUM_SESSION_STORAGE_KEY, sessionToken.trim());
    } else {
      window.localStorage.removeItem(IMPERIUM_SESSION_STORAGE_KEY);
    }

    if (sessionExpiresAt.trim()) {
      window.localStorage.setItem(IMPERIUM_SESSION_EXP_STORAGE_KEY, sessionExpiresAt);
    } else {
      window.localStorage.removeItem(IMPERIUM_SESSION_EXP_STORAGE_KEY);
    }

    if (deviceId.trim()) {
      window.localStorage.setItem(IMPERIUM_DEVICE_STORAGE_KEY, deviceId);
    }
  }, [sessionToken, sessionExpiresAt, deviceId]);

  useEffect(() => {
    let cancelled = false;

    const loadCore = async (): Promise<void> => {
      try {
        const [
          loadedMeta,
          loadedProviders,
          loadedProviderHealth,
          loadedBrief,
          loadedSinceLast,
          loadedWatchlist,
          loadedPortfolio,
          loadedPortfolioAccounts,
          loadedBusinessOverview,
          loadedBusinessMetrics,
          loadedBusinessAnomalies,
          loadedInbox,
          loadedClusters,
          loadedRegime,
          loadedIndicators,
          loadedRiskSignals,
          loadedTheses,
          loadedReminders,
          loadedPlaybooks,
          loadedAlertRules,
          loadedAlerts,
          loadedStreamContracts,
          loadedDlq,
          loadedAudit,
        ] = await Promise.all([
          fetchJson<ApiMetaResponse>("/api/v1/imperium/meta", authToken),
          fetchJson<ApiProvidersResponse>("/api/v1/imperium/providers", authToken),
          fetchJson<ApiProvidersHealthResponse>("/api/v1/imperium/providers/health", authToken),
          fetchJson<DailyBriefView>("/api/v1/imperium/brief/today", authToken),
          fetchJson<SinceLastView>("/api/v1/imperium/brief/since-last", authToken),
          fetchJson<MarketWatchlistItemView[]>("/api/v1/imperium/markets/watchlist", authToken),
          fetchJson<PortfolioOverviewView>("/api/v1/imperium/portfolio/overview", authToken),
          fetchJson<PortfolioAccountView[]>("/api/v1/imperium/portfolio/accounts", authToken),
          fetchJson<BusinessOverviewView>("/api/v1/imperium/business/overview", authToken),
          fetchJson<BusinessMetricView[]>("/api/v1/imperium/business/metrics", authToken),
          fetchJson<BusinessAnomalyView[]>("/api/v1/imperium/business/anomalies", authToken),
          fetchJson<InboxItemView[]>("/api/v1/imperium/intelligence/inbox", authToken),
          fetchJson<StoryClusterView[]>("/api/v1/imperium/intelligence/clusters", authToken),
          fetchJson<RegimeStateView>("/api/v1/imperium/risk/regime", authToken),
          fetchJson<MacroIndicatorView[]>("/api/v1/imperium/risk/indicators", authToken),
          fetchJson<RiskSignalView[]>("/api/v1/imperium/risk/signals", authToken),
          fetchJson<ThesisView[]>("/api/v1/imperium/journal/theses", authToken),
          fetchJson<ReminderView[]>("/api/v1/imperium/journal/reminders", authToken),
          fetchJson<PlaybookView[]>("/api/v1/imperium/journal/playbooks", authToken),
          fetchJson<AlertRuleView[]>("/api/v1/imperium/alerts/rules", authToken),
          fetchJson<AlertEventView[]>("/api/v1/imperium/alerts/feed", authToken),
          fetchJson<StreamContractView[]>("/api/v1/imperium/markets/stream/contracts", authToken),
          fetchJson<ApiDeadLetterResponse>("/api/v1/imperium/ops/dlq?limit=40", authToken),
          fetchJson<ApiAuditEventsResponse>("/api/v1/imperium/ops/audit?limit=60", authToken),
        ]);

        const quoteEntries = await Promise.allSettled(
          loadedWatchlist.slice(0, 12).map(async (entry) => {
            const quote = await fetchJson<MarketQuoteView>(
              `/api/v1/imperium/markets/${entry.symbol}/quote`,
              authToken
            );
            return [entry.symbol, quote] as const;
          })
        );

        if (cancelled) {
          return;
        }

        const mappedQuotes: Record<string, MarketQuoteView> = {};
        for (const settled of quoteEntries) {
          if (settled.status === "fulfilled") {
            const [symbol, quote] = settled.value;
            mappedQuotes[symbol] = quote;
          }
        }

        setMeta(loadedMeta);
        setProviders(loadedProviders);
        setProviderHealth(loadedProviderHealth);
        setBrief(loadedBrief);
        setSinceLast(loadedSinceLast);
        setWatchlist(loadedWatchlist);
        setQuotes(mappedQuotes);
        setPortfolio(loadedPortfolio);
        setPortfolioAccounts(loadedPortfolioAccounts);
        setBusinessOverview(loadedBusinessOverview);
        setBusinessMetrics(loadedBusinessMetrics);
        setBusinessAnomalies(loadedBusinessAnomalies);
        setInbox(loadedInbox);
        setClusters(loadedClusters);
        setRegime(loadedRegime);
        setIndicators(loadedIndicators);
        setRiskSignals(loadedRiskSignals);
        setTheses(loadedTheses);
        setReminders(loadedReminders);
        setPlaybooks(loadedPlaybooks);
        setAlertRules(loadedAlertRules);
        setAlerts(loadedAlerts);
        setStreamContracts(loadedStreamContracts);
        setDlq(loadedDlq);
        setAudit(loadedAudit);
        setError(null);
      } catch (requestError) {
        if (!cancelled) {
          setError(readError(requestError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadCore();
    const interval = window.setInterval(() => {
      void loadCore();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;

    const loadCandles = async (): Promise<void> => {
      try {
        const loadedCandles = await fetchJson<CandleView[]>(
          `/api/v1/imperium/markets/${selectedSymbol}/candles?interval=${selectedInterval}&limit=120`,
          authToken
        );

        if (!cancelled) {
          setCandles(loadedCandles);
        }
      } catch {
        if (!cancelled) {
          setCandles([]);
        }
      }
    };

    void loadCandles();
    const interval = window.setInterval(() => {
      void loadCandles();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedSymbol, selectedInterval, authToken]);

  useEffect(() => {
    if (watchlist.length === 0) {
      return;
    }

    const found = watchlist.some((entry) => entry.symbol === selectedSymbol);
    if (!found) {
      setSelectedSymbol(watchlist[0]?.symbol ?? "SPY");
    }
  }, [watchlist, selectedSymbol]);

  useEffect(() => {
    if (inbox.length === 0) {
      setActiveInboxKey(null);
      return;
    }

    const existing = activeInboxKey && inbox.some((item) => item.cluster_key === activeInboxKey);
    if (!existing) {
      setActiveInboxKey(inbox[0]?.cluster_key ?? null);
    }
  }, [inbox, activeInboxKey]);

  useEffect(() => {
    const params = new URLSearchParams({
      subject: "imperium.market.tick",
      event: "market_update",
      heartbeat_seconds: "15",
    });
    const source = new EventSource(
      `/api/v1/imperium/markets/stream/sse?${params.toString()}`
    );

    setMarketStreamState("connecting");
    source.onopen = () => {
      setMarketStreamState("live");
    };
    source.onerror = () => {
      setMarketStreamState("degraded");
    };

    const onMarketEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      const parsed = marketTickFromStream(tryParseJson(message.data));
      if (!parsed) {
        return;
      }

      setQuotes((previous) => ({
        ...previous,
        [parsed.symbol]: {
          symbol: parsed.symbol,
          price: parsed.price,
          change_percent: previous[parsed.symbol]?.change_percent ?? 0,
          volume: parsed.volume,
          timestamp: parsed.timestamp,
        },
      }));
    };

    source.addEventListener("market_update", onMarketEvent);

    return () => {
      source.removeEventListener("market_update", onMarketEvent);
      source.close();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      subject: "imperium.alert.event",
      event: "alert_event",
      heartbeat_seconds: "15",
    });
    const source = new EventSource(
      `/api/v1/imperium/alerts/stream/sse?${params.toString()}`
    );

    setAlertStreamState("connecting");
    source.onopen = () => {
      setAlertStreamState("live");
    };
    source.onerror = () => {
      setAlertStreamState("degraded");
    };

    const onAlertEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      const parsed = alertFromStream(tryParseJson(message.data));
      if (!parsed) {
        return;
      }

      setAlerts((previous) => {
        const deduped = previous.filter((item) => item.alert_id !== parsed.alert_id);
        return [parsed, ...deduped].slice(0, 120);
      });
    };

    source.addEventListener("alert_event", onAlertEvent);

    return () => {
      source.removeEventListener("alert_event", onAlertEvent);
      source.close();
    };
  }, []);

  const selectedModule = useMemo(
    () => MODULES.find((module) => module.key === activeModule) ?? MODULES[0],
    [activeModule]
  );

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return MODULES;
    }

    return MODULES.filter((module) => {
      return (
        module.label.toLowerCase().includes(query) ||
        module.description.toLowerCase().includes(query) ||
        module.shortcut.includes(query)
      );
    });
  }, [commandQuery]);

  const sparklinePoints = useMemo(() => buildSparklinePoints(candles), [candles]);
  const selectedInboxItem = useMemo(() => {
    if (!activeInboxKey) {
      return null;
    }

    return inbox.find((item) => item.cluster_key === activeInboxKey) ?? null;
  }, [activeInboxKey, inbox]);

  async function simulatePortfolioScenario(): Promise<void> {
    setScenarioPending(true);
    try {
      const response = await postJson<ScenarioSimulationResponse>(
        "/api/v1/imperium/portfolio/scenario/simulate",
        {
          scenario_name: "Market -3% / FX +1% / +25bps",
          market_drop_percent: 3,
          fx_shock_percent: 1,
          rate_spike_bps: 25,
        },
        authToken
      );
      setScenarioResult(response);
      setError(null);
    } catch (scenarioError) {
      setError(readError(scenarioError));
    } finally {
      setScenarioPending(false);
    }
  }

  async function togglePlaybook(playbook: PlaybookView): Promise<void> {
    try {
      const updated = await postJson<PlaybookView>(
        `/api/v1/imperium/journal/playbooks/${playbook.playbook_id}/toggle`,
        { enabled: !playbook.enabled },
        authToken
      );

      setPlaybooks((previous) =>
        previous.map((entry) => (entry.playbook_id === updated.playbook_id ? updated : entry))
      );
      setError(null);
    } catch (toggleError) {
      setError(readError(toggleError));
    }
  }

  async function issueSessionToken(): Promise<void> {
    setAuthPending(true);
    try {
      const payload = {
        user_id: "00000000-0000-0000-0000-000000000001",
        device_id: deviceId || "imperium-web-device",
        ttl_seconds: 60 * 60 * 24 * 14,
      };
      const session = await postJson<SessionIssueResponse>(
        "/api/v1/imperium/auth/session/token",
        payload
      );
      setSessionToken(session.token);
      setSessionExpiresAt(session.expires_at);
      setError(null);
    } catch (issueError) {
      setError(readError(issueError));
    } finally {
      setAuthPending(false);
    }
  }

  async function refreshSessionToken(): Promise<void> {
    if (!authToken) {
      return;
    }

    setAuthPending(true);
    try {
      const refreshed = await postJson<SessionRefreshResponse>(
        "/api/v1/imperium/auth/session/refresh",
        { session_token: authToken, ttl_seconds: 60 * 60 * 24 * 14 }
      );
      setSessionToken(refreshed.token);
      setSessionExpiresAt(refreshed.expires_at);
      setError(null);
    } catch (refreshError) {
      setError(readError(refreshError));
    } finally {
      setAuthPending(false);
    }
  }

  async function revokeSessionToken(): Promise<void> {
    if (!authToken) {
      return;
    }

    setAuthPending(true);
    try {
      await postJson<{ revoked: boolean }>(
        "/api/v1/imperium/auth/session/revoke",
        { session_token: authToken }
      );
      setSessionToken("");
      setSessionExpiresAt("");
      setError(null);
    } catch (revokeError) {
      setError(readError(revokeError));
    } finally {
      setAuthPending(false);
    }
  }

  async function replayDeadLetter(eventId: string): Promise<void> {
    setReplayingEventId(eventId);
    try {
      await postJson<ReplayDeadLetterResponse>(
        `/api/v1/imperium/ops/dlq/${eventId}/replay`,
        undefined,
        authToken
      );
      const [loadedDlq, loadedAudit] = await Promise.all([
        fetchJson<ApiDeadLetterResponse>("/api/v1/imperium/ops/dlq?limit=40", authToken),
        fetchJson<ApiAuditEventsResponse>("/api/v1/imperium/ops/audit?limit=60", authToken),
      ]);
      setDlq(loadedDlq);
      setAudit(loadedAudit);
    } catch (replayError) {
      setError(readError(replayError));
    } finally {
      setReplayingEventId(null);
    }
  }

  function renderBrief(): JSX.Element {
    if (!brief) {
      return <EmptyState label="Daily brief is not available yet." />;
    }

    return (
      <section className="module-grid module-grid-brief">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Strategic Brief</h3>
            <span>{formatTimestamp(brief.generated_at)}</span>
          </header>
          <p className="panel-copy">
            Structured briefing with citations. Read once, act all day.
          </p>
          <div className="section-stack">
            {brief.sections.map((section) => (
              <section key={section.section_key} className="section-card">
                <div className="section-headline">
                  <h4>{section.title}</h4>
                  <small>{section.claims.length} claims</small>
                </div>
                <p>{section.summary}</p>
                <ul className="claim-list">
                  {section.claims.map((claim) => (
                    <li key={`${section.section_key}-${claim.statement}`}>
                      <p>{claim.statement}</p>
                      <div className="claim-meta">
                        <span>Impact {claim.impact_score.toFixed(2)}</span>
                        <span>Confidence {claim.confidence_score.toFixed(2)}</span>
                        <span>{claim.citations.length} citations</span>
                      </div>
                      {claim.recommended_action ? (
                        <p className="action-pill">Action: {claim.recommended_action}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Required Reads</h3>
          </header>
          <ol className="read-list">
            {brief.required_reads.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Since Last Check</h3>
          </header>
          <ul className="simple-list">
            {(sinceLast?.items ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    );
  }

  function renderMarkets(): JSX.Element {
    return (
      <section className="module-grid module-grid-markets">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Live Candles</h3>
            <div className="panel-actions-cluster">
              <span className={marketStreamState === "live" ? "positive" : "negative"}>
                {marketStreamState}
              </span>
              <div className="interval-switcher" role="group" aria-label="Candle interval">
                {CANDLE_INTERVALS.map((interval) => (
                  <button
                    key={interval}
                    type="button"
                    className={interval === selectedInterval ? "is-active" : ""}
                    onClick={() => setSelectedInterval(interval)}
                  >
                    {interval}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="symbol-switcher" role="tablist" aria-label="Watchlist symbols">
            {watchlist.slice(0, 10).map((item) => (
              <button
                key={item.symbol}
                type="button"
                className={item.symbol === selectedSymbol ? "is-active" : ""}
                onClick={() => setSelectedSymbol(item.symbol)}
              >
                {item.symbol}
              </button>
            ))}
          </div>

          <div className="chart-shell">
            {candles.length > 1 ? (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Candle close sparkline">
                <polyline className="sparkline" points={sparklinePoints} />
              </svg>
            ) : (
              <p className="muted">Waiting for candle stream.</p>
            )}
          </div>

          <div className="market-snapshot">
            <span>Symbol: {selectedSymbol}</span>
            <span>Last: {formatLargeCurrency(quotes[selectedSymbol]?.price ?? 0)}</span>
            <span>Change: {formatPercent(quotes[selectedSymbol]?.change_percent ?? 0)}</span>
            <span>Volume: {(quotes[selectedSymbol]?.volume ?? 0).toLocaleString("en-US")}</span>
          </div>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Watchlist Tape</h3>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Price</th>
                <th>Change</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((item) => {
                const quote = quotes[item.symbol];
                return (
                  <tr key={item.symbol}>
                    <td>{item.symbol}</td>
                    <td>{quote ? formatLargeCurrency(quote.price) : "-"}</td>
                    <td className={(quote?.change_percent ?? 0) >= 0 ? "positive" : "negative"}>
                      {quote ? formatPercent(quote.change_percent) : "-"}
                    </td>
                    <td>{quote ? formatTimestamp(quote.timestamp) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </article>
      </section>
    );
  }

  function renderPortfolio(): JSX.Element {
    if (!portfolio) {
      return <EmptyState label="Portfolio data unavailable." />;
    }

    const accountRows = portfolioAccounts.length > 0 ? portfolioAccounts : portfolio.accounts;

    return (
      <section className="module-grid">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Net Worth Command</h3>
            <span>{formatTimestamp(portfolio.as_of)}</span>
          </header>

          <div className="metric-rail">
            <Metric label="Net Worth" value={formatCurrency(portfolio.net_worth)} />
            <Metric
              label="Daily"
              value={formatCurrency(portfolio.daily_change)}
              valueClass={portfolio.daily_change >= 0 ? "positive" : "negative"}
            />
            <Metric
              label="YTD"
              value={formatCurrency(portfolio.ytd_change)}
              valueClass={portfolio.ytd_change >= 0 ? "positive" : "negative"}
            />
            <Metric label="Risk" value={portfolio.risk_score.toFixed(1)} />
          </div>

          <h4>Top Positions</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Class</th>
                <th>Qty</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.top_positions.map((position) => (
                <tr key={`${position.symbol}-${position.asset_class}`}>
                  <td>{position.symbol}</td>
                  <td>{position.asset_class}</td>
                  <td>{position.quantity.toFixed(2)}</td>
                  <td>{formatCurrency(position.market_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Accounts</h3>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {accountRows.map((account) => (
                <tr key={account.account_id}>
                  <td>{account.name}</td>
                  <td>{account.account_type}</td>
                  <td>{formatCurrency(account.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Exposure</h3>
          </header>
          <ul className="bar-list">
            {portfolio.exposures.map((exposure) => (
              <li key={exposure.bucket}>
                <label>
                  <span>{exposure.bucket}</span>
                  <span>{exposure.weight_percent.toFixed(1)}%</span>
                </label>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${Math.min(100, exposure.weight_percent)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Scenario Simulation</h3>
            <span>Operator stress test</span>
          </header>
          <p className="panel-copy">
            Run deterministic portfolio shock tests before market open.
          </p>
          <button
            type="button"
            className="scenario-button"
            disabled={scenarioPending}
            onClick={() => {
              void simulatePortfolioScenario();
            }}
          >
            {scenarioPending ? "Running..." : "Simulate Market -3%"}
          </button>
          {scenarioResult ? (
            <ul className="simple-list">
              <li>
                <strong>{scenarioResult.scenario_name}</strong>
                <span>Estimated loss {formatCurrency(scenarioResult.estimated_loss)}</span>
                <span>Liquidity impact {formatCurrency(scenarioResult.liquidity_impact)}</span>
                <span>Suggested hedge {formatCurrency(scenarioResult.hedge_notional)}</span>
              </li>
            </ul>
          ) : (
            <p className="muted">No simulation run in this session.</p>
          )}
        </article>
      </section>
    );
  }

  function renderBusiness(): JSX.Element {
    if (!businessOverview) {
      return <EmptyState label="Business telemetry unavailable." />;
    }

    return (
      <section className="module-grid">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Operator Mode</h3>
            <span>{businessOverview.entity_name}</span>
          </header>
          <div className="metric-rail">
            <Metric label="MRR" value={formatCurrency(businessOverview.mrr)} />
            <Metric label="Burn" value={formatCurrency(businessOverview.burn)} />
            <Metric label="Runway" value={`${businessOverview.runway_months.toFixed(1)} months`} />
            <Metric label="Cash" value={formatCurrency(businessOverview.cash_balance)} />
            <Metric label="Overdue" value={businessOverview.overdue_invoices.toString()} />
          </div>

          <h4>Metrics</h4>
          <ul className="simple-list two-col">
            {businessMetrics.map((metric) => (
              <li key={`${metric.key}-${metric.window}`}>
                <strong>{metric.key}</strong>
                <span>{metric.window}</span>
                <span>{metric.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Anomalies</h3>
          </header>
          <ul className="alert-list">
            {businessAnomalies.map((anomaly) => (
              <li key={`${anomaly.metric_key}-${anomaly.message}`}>
                <p>
                  <strong>{anomaly.metric_key}</strong> <span>{anomaly.severity}</span>
                </p>
                <p>{anomaly.message}</p>
                <p className="muted">{anomaly.recommended_action}</p>
              </li>
            ))}
          </ul>
        </article>
      </section>
    );
  }

  function renderIntelligence(): JSX.Element {
    return (
      <section className="module-grid">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Intelligence Inbox</h3>
            <span>{inbox.length} ranked items</span>
          </header>
          <div className="section-stack">
            {inbox.map((item) => (
              <article
                key={item.cluster_key}
                className={item.cluster_key === activeInboxKey ? "section-card is-selected" : "section-card"}
              >
                <div className="section-headline">
                  <h4>{item.title}</h4>
                  <small>Impact {item.impact_score.toFixed(2)}</small>
                </div>
                <p>{item.summary}</p>
                <div className="claim-meta">
                  <span>{item.source_count} sources</span>
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => setActiveInboxKey(item.cluster_key)}
                  >
                    Read
                  </button>
                  <a href={item.canonical_url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Narrative Clusters</h3>
          </header>
          <ul className="simple-list">
            {clusters.map((cluster) => (
              <li key={cluster.cluster_key}>
                <strong>{cluster.title}</strong>
                <span>{cluster.article_count} articles</span>
                <span>Impact {cluster.impact_score.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => setActiveInboxKey(cluster.cluster_key)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel reading-panel">
          <header className="panel-header">
            <h3>Reading Room</h3>
            <span>{selectedInboxItem ? "Parchment mode" : "No selection"}</span>
          </header>
          {selectedInboxItem ? (
            <div className="reader-shell">
              <h4>{selectedInboxItem.title}</h4>
              <p>{selectedInboxItem.summary}</p>
              <p className="muted">Impact {selectedInboxItem.impact_score.toFixed(2)}</p>
              <p className="muted">{selectedInboxItem.source_count} corroborating sources</p>
              <a href={selectedInboxItem.canonical_url} target="_blank" rel="noreferrer">
                Open primary source
              </a>
            </div>
          ) : (
            <p className="muted">Select a cluster or inbox card to enter reading mode.</p>
          )}
        </article>
      </section>
    );
  }

  function renderRisk(): JSX.Element {
    return (
      <section className="module-grid">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Regime State</h3>
            <span>{regime ? formatTimestamp(regime.updated_at) : "no update"}</span>
          </header>
          {regime ? (
            <>
              <p className="regime-pill">{regime.regime.replace("_", " ")}</p>
              <p className="panel-copy">{regime.explanation}</p>
              <p className="muted">Confidence {regime.confidence.toFixed(2)}</p>
            </>
          ) : (
            <p className="muted">Regime model not available.</p>
          )}
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Risk Signals</h3>
          </header>
          <ul className="alert-list">
            {riskSignals.map((signal) => (
              <li key={`${signal.key}-${signal.created_at}`}>
                <p>
                  <strong>{signal.key}</strong> <span>{signal.severity}</span>
                </p>
                <p>{signal.description}</p>
                <p className="muted">{formatTimestamp(signal.created_at)}</p>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Macro Indicators</h3>
            <span>{indicators.length} tracked</span>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Indicator</th>
                <th>Value</th>
                <th>Change</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((indicator) => (
                <tr key={`${indicator.key}-${indicator.updated_at}`}>
                  <td>{indicator.key}</td>
                  <td>{indicator.value.toFixed(2)}</td>
                  <td className={indicator.change >= 0 ? "positive" : "negative"}>
                    {formatPercent(indicator.change)}
                  </td>
                  <td>{formatTimestamp(indicator.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    );
  }

  function renderJournal(): JSX.Element {
    return (
      <section className="module-grid">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Decision Journal</h3>
            <span>{theses.length} active theses</span>
          </header>
          <div className="section-stack">
            {theses.map((thesis) => (
              <article className="section-card" key={thesis.thesis_id}>
                <div className="section-headline">
                  <h4>{thesis.title}</h4>
                  <small>{thesis.conviction_percent.toFixed(0)}%</small>
                </div>
                <p>{thesis.rationale}</p>
                <p className="muted">Invalidate on: {thesis.invalidation_criteria}</p>
                <p className="muted">Review: {thesis.review_date}</p>
              </article>
            ))}
          </div>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Playbooks</h3>
          </header>
          <ul className="simple-list">
            {playbooks.map((playbook) => (
              <li key={playbook.playbook_id}>
                <strong>{playbook.title}</strong>
                <span>{playbook.enabled ? "enabled" : "disabled"}</span>
                <span>{playbook.trigger}</span>
                <button
                  type="button"
                  onClick={() => {
                    void togglePlaybook(playbook);
                  }}
                >
                  {playbook.enabled ? "Disable" : "Enable"}
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Review Reminders</h3>
            <span>{reminders.length}</span>
          </header>
          <ul className="simple-list">
            {reminders.map((reminder) => (
              <li key={`${reminder.thesis_id}-${reminder.review_date}`}>
                <strong>{reminder.title}</strong>
                <span>Review by {reminder.review_date}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>
    );
  }

  function renderOps(): JSX.Element {
    const debugClaims = (brief?.sections ?? []).flatMap((section) =>
      section.claims.map((claim) => ({
        section: section.title,
        statement: claim.statement,
        citations: claim.citations,
      }))
    );

    return (
      <section className="module-grid">
        <article className="panel panel-large">
          <header className="panel-header">
            <h3>Provider Health</h3>
            <span>{providerHealth?.checked_at ? formatTimestamp(providerHealth.checked_at) : "-"}</span>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {(providerHealth?.checks ?? []).map((check) => (
                <tr key={check.domain}>
                  <td>{check.domain}</td>
                  <td>{check.provider}</td>
                  <td className={check.healthy ? "positive" : "negative"}>
                    {check.healthy ? "healthy" : "degraded"}
                  </td>
                  <td>{check.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Dead-Letter Queue</h3>
            <span>{dlq?.events.length ?? 0} events</span>
          </header>
          <ul className="simple-list">
            {(dlq?.events ?? []).slice(0, 10).map((event) => (
              <li key={event.event_id}>
                <strong>{event.subject}</strong>
                <span>{event.worker_role}</span>
                <span>{event.status}</span>
                <span>{formatTimestamp(event.last_failed_at)}</span>
                <button
                  type="button"
                  disabled={replayingEventId === event.event_id}
                  onClick={() => {
                    void replayDeadLetter(event.event_id);
                  }}
                >
                  {replayingEventId === event.event_id ? "Replaying..." : "Replay"}
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Audit Feed</h3>
          </header>
          <ul className="simple-list">
            {(audit?.events ?? []).slice(0, 12).map((event) => (
              <li key={event.event_id}>
                <strong>{event.action}</strong>
                <span>{event.stream_key}</span>
                <span>{event.target}</span>
                <span>{formatTimestamp(event.created_at)}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Alert Rules</h3>
            <span>{alertRules.length}</span>
          </header>
          <ul className="simple-list">
            {alertRules.slice(0, 10).map((rule) => (
              <li key={rule.rule_id}>
                <strong>{rule.name}</strong>
                <span>{rule.category}</span>
                <span>
                  Threshold {rule.threshold.toFixed(2)} | Cooldown {rule.cooldown_seconds}s
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Stream Contracts</h3>
            <span>{streamContracts.length}</span>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Subject</th>
                <th>Schema</th>
              </tr>
            </thead>
            <tbody>
              {streamContracts.map((contract) => (
                <tr key={`${contract.channel}-${contract.subject}`}>
                  <td>{contract.channel}</td>
                  <td>{contract.subject}</td>
                  <td>{contract.payload_schema}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        {adminMode ? (
          <article className="panel panel-large">
            <header className="panel-header">
              <h3>Citation Integrity</h3>
              <span>{debugClaims.length} claims</span>
            </header>
            <div className="section-stack">
              {debugClaims.map((claim) => (
                <article key={`${claim.section}-${claim.statement}`} className="section-card">
                  <div className="section-headline">
                    <h4>{claim.section}</h4>
                    <small>{claim.citations.length} sources</small>
                  </div>
                  <p>{claim.statement}</p>
                  <ul className="claim-list">
                    {claim.citations.map((citation) => (
                      <li key={`${citation.source_url}-${citation.source_snippet}`}>
                        <p className="muted">{citation.source_snippet}</p>
                        <a href={citation.source_url} target="_blank" rel="noreferrer">
                          {citation.source_url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </article>
        ) : null}

        {adminMode ? (
          <article className="panel">
            <header className="panel-header">
              <h3>Alert Decision Ledger</h3>
              <span>{alerts.length}</span>
            </header>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Dedupe</th>
                  <th>What Next</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 15).map((alert) => (
                  <tr key={alert.alert_id}>
                    <td>{alert.title}</td>
                    <td>{alert.category}</td>
                    <td>{alert.dedupe_key}</td>
                    <td>{alert.what_to_watch_next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ) : null}
      </section>
    );
  }

  function renderActiveModule(): JSX.Element {
    switch (activeModule) {
      case "brief":
        return renderBrief();
      case "markets":
        return renderMarkets();
      case "portfolio":
        return renderPortfolio();
      case "business":
        return renderBusiness();
      case "intelligence":
        return renderIntelligence();
      case "risk":
        return renderRisk();
      case "journal":
        return renderJournal();
      case "ops":
        return renderOps();
      default:
        return <EmptyState label="Unknown module selection." />;
    }
  }

  return (
    <main className="imperium-app">
      <aside className="imperium-sidebar">
        <div className="brand-block">
          <p className="kicker">Imperium</p>
          <h1>Sovereign Terminal</h1>
          <p>{meta?.data_mode ?? "-"} mode</p>
        </div>

        <section className="auth-block">
          <header className="auth-header">
            <h2>Session</h2>
            <span className={authToken ? "positive" : "negative"}>
              {authToken ? "active" : "missing"}
            </span>
          </header>
          <p className="muted">
            {sessionExpiresAt
              ? `Expires ${formatTimestamp(sessionExpiresAt)}`
              : "Issue a local session token to use protected endpoints."}
          </p>
          <div className="auth-actions">
            <button type="button" onClick={() => void issueSessionToken()} disabled={authPending}>
              {authPending ? "Working..." : "Issue"}
            </button>
            <button
              type="button"
              onClick={() => void refreshSessionToken()}
              disabled={authPending || !authToken}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void revokeSessionToken()}
              disabled={authPending || !authToken}
            >
              Revoke
            </button>
          </div>
        </section>

        <nav className="module-nav" aria-label="Module navigation">
          {MODULES.map((module) => (
            <button
              key={module.key}
              type="button"
              className={module.key === activeModule ? "is-active" : ""}
              onClick={() => setActiveModule(module.key)}
            >
              <span>{module.label}</span>
              <small>{module.shortcut}</small>
            </button>
          ))}
        </nav>

        <div className="provider-summary">
          <h2>Provider Readiness</h2>
          <button
            type="button"
            className={adminMode ? "admin-toggle is-active" : "admin-toggle"}
            onClick={() => setAdminMode((current) => !current)}
          >
            {adminMode ? "Admin Debug On" : "Admin Debug Off"}
          </button>
          {(providers?.providers ?? []).map((provider) => (
            <p key={`${provider.domain}-${provider.primary}`}>
              <span>{provider.domain}</span>
              <strong>{provider.configured ? "ready" : "missing"}</strong>
            </p>
          ))}
        </div>
      </aside>

      <section className="imperium-main">
        <header className="main-header">
          <div>
            <p className="kicker">{new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date())}</p>
            <h2>{selectedModule.label}</h2>
            <p>{selectedModule.description}</p>
          </div>
          <div className="header-actions">
            <button type="button" onClick={() => setCommandOpen(true)}>
              Command Bar
            </button>
            <div className="status-pill">
              {loading ? "Syncing" : "Live"}
              {error ? <span className="negative">Issue</span> : null}
            </div>
            <div className="stream-pill-row">
              <span>
                Market stream{" "}
                <strong className={marketStreamState === "live" ? "positive" : "negative"}>
                  {marketStreamState}
                </strong>
              </span>
              <span>
                Alert stream{" "}
                <strong className={alertStreamState === "live" ? "positive" : "negative"}>
                  {alertStreamState}
                </strong>
              </span>
            </div>
          </div>
        </header>

        {error ? <div className="error-banner">Runtime issue: {error}</div> : null}

        {renderActiveModule()}
      </section>

      <aside className="imperium-context">
        <section className="context-panel">
          <header className="panel-header">
            <h3>AI Context</h3>
            <span>Cmd+K</span>
          </header>
          <ul className="simple-list">
            {(sinceLast?.items ?? []).slice(0, 6).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="context-panel">
          <header className="panel-header">
            <h3>Alerts</h3>
            <span>{alerts.length}</span>
          </header>
          <ul className="alert-list">
            {alerts.slice(0, 8).map((alert) => (
              <li key={alert.alert_id}>
                <p>
                  <strong>{alert.title}</strong>
                  <span>{alert.category}</span>
                </p>
                <p>{alert.why_it_matters}</p>
                <p className="muted">{formatTimestamp(alert.created_at)}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      {commandOpen ? (
        <div className="command-overlay" role="dialog" aria-modal="true" aria-label="Command bar">
          <div className="command-modal">
            <input
              autoFocus
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.currentTarget.value)}
              placeholder="Jump to module, type provider, or review alerts"
            />
            <ul>
              {filteredCommands.map((module) => (
                <li key={module.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModule(module.key);
                      setCommandOpen(false);
                      setCommandQuery("");
                    }}
                  >
                    <div>
                      <strong>{module.label}</strong>
                      <p>{module.description}</p>
                    </div>
                    <span>Cmd+{module.shortcut}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function EmptyState(props: { label: string }): JSX.Element {
  return <div className="empty-state">{props.label}</div>;
}

function Metric(props: { label: string; value: string; valueClass?: string }): JSX.Element {
  return (
    <article className="metric-card">
      <span>{props.label}</span>
      <strong className={props.valueClass}>{props.value}</strong>
    </article>
  );
}
