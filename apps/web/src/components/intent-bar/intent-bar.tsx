import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ClipboardList,
  Code2,
  Eye,
  FileText,
  Gauge,
  Loader2,
  Mail,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Kbd,
} from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  askAPI,
  contentAPI,
  continuumsAPI,
  searchAPI,
  type AskResponse,
  type ContentSearchResult,
  type SearchResult,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { useApiTraceStore } from "@/lib/api-trace";
import { cn } from "@/lib/utils";

type IntentBarMode = "ask" | "find" | "build" | "act" | "inspect";

type TraceSnapshot = {
  requestId?: string;
  status: number;
  durationMs: number;
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);

  return debounced;
}

function IntentBarHint({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}

function getModeMeta(mode: IntentBarMode) {
  switch (mode) {
    case "ask":
      return {
        label: "Ask",
        icon: Sparkles,
        hint: "Evidence-first answers",
        placeholder: "Ask Drovi. It will only answer with citations.",
      };
    case "find":
      return {
        label: "Find",
        icon: Search,
        hint: "Hybrid search across memory",
        placeholder: "Search commitments, decisions, messages, continuums…",
      };
    case "build":
      return {
        label: "Build",
        icon: Code2,
        hint: "Continuum creation and editing",
        placeholder: "Create or edit a continuum…",
      };
    case "act":
      return {
        label: "Act",
        icon: Zap,
        hint: "Stage and execute actuations",
        placeholder: "Run a simulation or stage an actuation…",
      };
    case "inspect":
      return {
        label: "Inspect",
        icon: Eye,
        hint: "Timelines, trust, contradictions",
        placeholder: "Jump to an inspection surface…",
      };
  }
}

function shouldOpenWithCtrl(e: KeyboardEvent) {
  // Support Ctrl+K for Windows/Linux, Cmd+K for macOS.
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
}

function resultToRoute(result: SearchResult): string | null {
  const type = result.type?.toLowerCase?.() ?? "";
  const id = result.id;
  if (!id) {
    return null;
  }

  // Unified Intelligence Objects.
  if (
    [
      "uio",
      "commitment",
      "decision",
      "task",
      "risk",
      "claim",
      "brief",
      "topic",
      "project",
      "advice",
    ].includes(type)
  ) {
    return `/dashboard/uio/${id}`;
  }

  return null;
}

function getResultTitle(result: SearchResult): string {
  if (result.title) {
    return result.title;
  }

  const props = result.properties ?? {};
  const name = props["canonicalTitle"] ?? props["title"] ?? props["name"];
  if (typeof name === "string" && name.trim().length > 0) {
    return name;
  }

  return result.id ?? "Result";
}

function getResultSubtitle(result: SearchResult): string | null {
  const props = result.properties ?? {};
  const description =
    props["canonicalDescription"] ??
    props["description"] ??
    props["summary"] ??
    props["text"];
  if (typeof description === "string" && description.trim().length > 0) {
    return description.length > 120 ? `${description.slice(0, 120)}…` : description;
  }
  return null;
}

function formatContentTitle(result: ContentSearchResult): string {
  if (typeof result.title === "string" && result.title.trim().length > 0) {
    return result.title;
  }
  if (typeof result.snippet === "string" && result.snippet.trim().length > 0) {
    const trimmed = result.snippet.trim();
    return trimmed.length > 64 ? `${trimmed.slice(0, 64)}…` : trimmed;
  }
  return result.kind === "document" ? "Document" : "Message";
}

function formatContentSubtitle(result: ContentSearchResult): string | null {
  const parts: string[] = [];
  if (result.source_type) parts.push(result.source_type);
  if (typeof result.captured_at === "string" && result.captured_at) {
    try {
      parts.push(new Date(result.captured_at).toLocaleString());
    } catch {
      // Ignore date parsing failures.
    }
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function ModePill({
  mode,
  current,
  onSelect,
  shortcut,
}: {
  mode: IntentBarMode;
  current: IntentBarMode;
  onSelect: (mode: IntentBarMode) => void;
  shortcut: string;
}) {
  const meta = getModeMeta(mode);
  const Icon = meta.icon;
  const active = mode === current;
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors",
        active
          ? "border-border bg-background text-foreground shadow-sm"
          : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      onClick={() => onSelect(mode)}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{meta.label}</span>
      <span className="ml-1 hidden sm:inline-flex">
        <Kbd>{shortcut}</Kbd>
      </span>
    </button>
  );
}

function FilterPill({
  active,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors",
        disabled ? "opacity-50" : "",
        active
          ? "border-border bg-background text-foreground shadow-sm"
          : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <span>{label}</span>
    </button>
  );
}

export function IntentBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const traces = useApiTraceStore((state) => state.traces);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<IntentBarMode>("ask");
  const [query, setQuery] = useState("");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [findFilters, setFindFilters] = useState({
    uios: true,
    messages: true,
    docs: true,
    continuums: true,
  });

  const inputRef = useRef<HTMLInputElement | null>(null);
  const debouncedQuery = useDebouncedValue(query, 200);

  const modeMeta = useMemo(() => getModeMeta(mode), [mode]);

  // Global keyboard shortcut.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldOpenWithCtrl(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Mode shortcuts inside the palette.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const key = e.key;
      if (key === "1") setMode("ask");
      if (key === "2") setMode("find");
      if (key === "3") setMode("build");
      if (key === "4") setMode("act");
      if (key === "5") setMode("inspect");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Focus the input on open.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open, mode]);

  // Reset transient state on close.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setAskResult(null);
    setAsking(false);
    setMode("ask");
    setShowDebug(false);
    setFindFilters({
      uios: true,
      messages: true,
      docs: true,
      continuums: true,
    });
  }, [open]);

  // Clear ask results when leaving Ask mode.
  useEffect(() => {
    if (mode === "ask") return;
    setAskResult(null);
    setAsking(false);
  }, [mode]);

  const askTrace = useMemo(
    () => traces.find((t) => t.endpoint === "/api/v1/ask") ?? null,
    [traces]
  );
  const searchTrace = useMemo(
    () => traces.find((t) => t.endpoint === "/api/v1/search") ?? null,
    [traces]
  );
  const contentTrace = useMemo(
    () => traces.find((t) => t.endpoint === "/api/v1/content/search") ?? null,
    [traces]
  );
  const continuumsTrace = useMemo(
    () =>
      traces.find((t) => t.endpoint.startsWith("/api/v1/continuums?")) ?? null,
    [traces]
  );

  const latestTraces = useMemo(() => {
    const snapshot: Record<string, TraceSnapshot> = {};
    if (askTrace) {
      snapshot.ask = {
        requestId: askTrace.requestId,
        status: askTrace.status,
        durationMs: askTrace.durationMs,
      };
    }
    if (searchTrace) {
      snapshot.search = {
        requestId: searchTrace.requestId,
        status: searchTrace.status,
        durationMs: searchTrace.durationMs,
      };
    }
    if (contentTrace) {
      snapshot.content = {
        requestId: contentTrace.requestId,
        status: contentTrace.status,
        durationMs: contentTrace.durationMs,
      };
    }
    if (continuumsTrace) {
      snapshot.continuums = {
        requestId: continuumsTrace.requestId,
        status: continuumsTrace.status,
        durationMs: continuumsTrace.durationMs,
      };
    }
    return snapshot;
  }, [askTrace, contentTrace, continuumsTrace, searchTrace]);

  const {
    data: uioSearchResponse,
    isLoading: searchingUios,
    isError: uioSearchError,
    error: uioSearchErrorObj,
  } = useQuery({
    queryKey: [
      "intent-bar-search-uios",
      user?.org_id ?? "none",
      debouncedQuery,
      findFilters.uios,
    ],
    queryFn: () =>
      searchAPI.search({
        query: debouncedQuery,
        types: ["Commitment", "Decision", "Task", "Risk", "Claim"],
        include_graph_context: false,
        limit: 10,
      }),
    enabled:
      open &&
      mode === "find" &&
      findFilters.uios &&
      Boolean(user?.org_id) &&
      debouncedQuery.trim().length >= 2,
    staleTime: 10_000,
  });

  const {
    data: contentSearchResponse,
    isLoading: searchingContent,
    isError: contentSearchError,
    error: contentSearchErrorObj,
  } = useQuery({
    queryKey: [
      "intent-bar-search-content",
      user?.org_id ?? "none",
      debouncedQuery,
      findFilters.messages,
      findFilters.docs,
    ],
    queryFn: () =>
      contentAPI.search({
        query: debouncedQuery,
        organizationId: user?.org_id,
        kinds: [
          ...(findFilters.messages ? (["message"] as const) : []),
          ...(findFilters.docs ? (["document"] as const) : []),
        ],
        limit: 10,
      }),
    enabled:
      open &&
      mode === "find" &&
      Boolean(user?.org_id) &&
      debouncedQuery.trim().length >= 2 &&
      (findFilters.messages || findFilters.docs),
    staleTime: 10_000,
  });

  const { data: continuums, isLoading: loadingContinuums } = useQuery({
    queryKey: ["intent-bar-continuums", user?.org_id ?? "none"],
    queryFn: () => continuumsAPI.list(user?.org_id ?? ""),
    enabled: open && mode === "find" && Boolean(user?.org_id),
    staleTime: 60_000,
  });

  const uioResults = uioSearchResponse?.results ?? [];
  const contentResults = contentSearchResponse?.results ?? [];
  const continuumResults = useMemo(() => {
    if (!findFilters.continuums) return [];
    if (!continuums) return [];
    const q = debouncedQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return continuums
      .filter((c) => {
        const name = String(c.name ?? "").toLowerCase();
        const desc = String(c.description ?? "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      })
      .slice(0, 8);
  }, [continuums, debouncedQuery, findFilters.continuums]);

  const handleAsk = async (overrideQuestion?: string) => {
    if (!user?.org_id) {
      toast.error("Sign in to ask questions.");
      return;
    }

    const q = (overrideQuestion ?? query).trim();
    if (q.length < 3) {
      return;
    }

    setAsking(true);
    try {
      const res = await askAPI.ask({
        question: q,
        organizationId: user.org_id,
        includeEvidence: true,
      });
      setAskResult(res);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  };

  const handleNavigate = (to: string) => {
    setOpen(false);
    navigate({ to });
  };

  type IntentCommand = {
    id: string;
    title: string;
    description: string;
    icon: ElementType;
    to?: string;
    shortcut?: string;
    when?: (ctx: { pathname: string; userRole?: string | null }) => boolean;
    action?: () => void;
  };

  const userRole = user?.role ?? null;
  const pathname = location.pathname;
  const isAdmin = userRole === "pilot_owner" || userRole === "pilot_admin";
  const currentUioId = useMemo(() => {
    const match = pathname.match(/^\/dashboard\/uio\/([^/]+)$/);
    return match?.[1] ?? null;
  }, [pathname]);

  const registry = useMemo(() => {
    const ctx = { pathname, userRole };

    const global: IntentCommand[] = [
      {
        id: "go-console",
        title: "Open Console",
        description: "Primary intelligence view",
        icon: Gauge,
        to: "/dashboard/console",
      },
      {
        id: "go-sources",
        title: "Connected Sources",
        description: "Connect, backfill, and monitor ingestion",
        icon: Activity,
        to: "/dashboard/sources",
      },
      {
        id: "go-team",
        title: "Team members",
        description: "Roles, invitations, org policies",
        icon: Eye,
        to: "/dashboard/team/members",
        when: () => isAdmin,
      },
      {
        id: "copy-link",
        title: "Copy link to current page",
        description: "Share this exact view with a teammate",
        icon: ArrowRight,
        shortcut: "⌘C",
        when: () => pathname.startsWith("/dashboard/"),
        action: () => {
          const url =
            typeof window !== "undefined"
              ? window.location.href
              : pathname;
          void navigator.clipboard
            .writeText(url)
            .then(() => toast.success("Link copied"))
            .catch(() => toast.error("Failed to copy link"));
        },
      },
      {
        id: "copy-uio-id",
        title: "Copy selected UIO id",
        description: "Copy the UIO id from the current page",
        icon: ClipboardList,
        when: () => Boolean(currentUioId),
        action: () => {
          if (!currentUioId) return;
          void navigator.clipboard
            .writeText(currentUioId)
            .then(() => toast.success("UIO id copied"))
            .catch(() => toast.error("Failed to copy"));
        },
      },
    ];

    const build: IntentCommand[] = [
      {
        id: "go-builder",
        title: "Open Continuum Builder",
        description: "Create or update a continuum definition",
        icon: Code2,
        to: "/dashboard/builder",
        shortcut: "⌥3",
      },
      {
        id: "go-continuums",
        title: "Open Continuums runtime",
        description: "Runs, schedules, previews, and rollbacks",
        icon: Sparkles,
        to: "/dashboard/continuums",
      },
      {
        id: "go-exchange",
        title: "Browse Continuum Exchange",
        description: "Install curated playbooks",
        icon: ClipboardList,
        to: "/dashboard/exchange",
      },
    ];

    const act: IntentCommand[] = [
      {
        id: "go-simulations",
        title: "Open Simulations",
        description: "Preview outcomes before acting",
        icon: Activity,
        to: "/dashboard/simulations",
      },
      {
        id: "go-actuations",
        title: "Open Actuations",
        description: "Stage, approve, execute",
        icon: Zap,
        to: "/dashboard/actuations",
      },
    ];

    const inspect: IntentCommand[] = [
      {
        id: "go-reality",
        title: "Reality Stream",
        description: "Every change, chronologically",
        icon: Activity,
        to: "/dashboard/reality-stream",
      },
      {
        id: "go-graph",
        title: "Graph",
        description: "Explore the memory graph",
        icon: Activity,
        to: "/dashboard/graph",
      },
      {
        id: "go-trust",
        title: "Trust & Audit",
        description: "Evidence, guardrails, and audit trails",
        icon: Eye,
        to: "/dashboard/trust",
      },
    ];

    const filtered = (items: IntentCommand[]) =>
      items.filter((cmd) => (cmd.when ? cmd.when(ctx) : true));

    return {
      global: filtered(global),
      build: filtered(build),
      act: filtered(act),
      inspect: filtered(inspect),
    };
  }, [currentUioId, isAdmin, pathname, userRole]);

  const renderBody = () => {
    if (!user) {
      return (
        <>
          <IntentBarHint>Sign in to use the Intent Bar.</IntentBarHint>
          <CommandGroup heading="Session">
            <CommandItem onSelect={() => handleNavigate("/login")}>
              <ArrowRight className="h-4 w-4" />
              Sign in
            </CommandItem>
          </CommandGroup>
        </>
      );
    }

    if (mode === "ask") {
      if (askResult) {
        const citations = askResult.sources ?? [];
        const hasEvidence = citations.length > 0;
        return (
          <>
            <CommandGroup heading={hasEvidence ? "Answer" : "Answer (no evidence)"}>
              <div className="px-2 py-2 text-[13px] leading-relaxed text-foreground">
                <div className="whitespace-pre-wrap">{askResult.answer}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                    {askResult.intent}
                  </span>
                  <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                    {citations.length} cite{citations.length === 1 ? "" : "s"}
                  </span>
                  <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                    {Math.round((askResult.duration_seconds ?? 0) * 1000)}ms
                  </span>
                  {askTrace?.requestId ? (
                    <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                      req {askTrace.requestId}
                    </span>
                  ) : null}
                </div>
              </div>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Evidence">
              {!hasEvidence ? (
                <>
                  <IntentBarHint>
                    No evidence found. Drovi will not guess.
                  </IntentBarHint>
                  <CommandItem onSelect={() => handleNavigate("/dashboard/sources")}>
                    <ArrowRight className="h-4 w-4" />
                    Check ingestion status in Connected Sources
                  </CommandItem>
                </>
              ) : (
                citations.slice(0, 8).map((source, idx) => (
                  <CommandItem
                    key={`${source.segment_hash ?? idx}`}
                    onSelect={() => {
                      // Best-effort: jump to UIO if present, otherwise open the Sources page.
                      const uioId = typeof source.uio_id === "string" ? source.uio_id : null;
                      if (uioId) {
                        handleNavigate(`/dashboard/uio/${uioId}`);
                        return;
                      }
                      handleNavigate("/dashboard/sources");
                    }}
                  >
                    <div className="flex w-full flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">
                          {(source.name as string | undefined) ||
                            (source.title as string | undefined) ||
                            `Source ${idx + 1}`}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          #{idx + 1}
                        </span>
                      </div>
                      {typeof source.quoted_text === "string" && source.quoted_text.trim().length > 0 ? (
                        <span className="line-clamp-2 text-[12px] text-muted-foreground">
                          {source.quoted_text}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
            {showDebug ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Debug">
                  <DebugTraceItem
                    label="ask"
                    trace={latestTraces.ask}
                  />
                  <DebugTraceItem
                    label="search"
                    trace={latestTraces.search}
                  />
                  <DebugTraceItem
                    label="content"
                    trace={latestTraces.content}
                  />
                </CommandGroup>
              </>
            ) : null}
          </>
        );
      }

      return (
        <>
          <IntentBarHint>
            {asking ? "Asking…" : "Type a question and press Enter."}
          </IntentBarHint>
          <CommandGroup heading="Examples">
            {[
              "What commitments are at risk right now?",
              "What changed in the last 24 hours?",
              "Show me decisions about the pilot rollout.",
              "What are the unresolved risks for this week?",
            ].map((example) => (
              <CommandItem
                key={example}
                onSelect={() => {
                  setQuery(example);
                  void handleAsk(example);
                }}
              >
                <Sparkles className="h-4 w-4" />
                {example}
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      );
    }

    if (mode === "find") {
      const q = debouncedQuery.trim();
      const anyLoading = searchingUios || searchingContent || loadingContinuums;
      const anyError = uioSearchError || contentSearchError;
      const totalResults =
        uioResults.length + contentResults.length + continuumResults.length;

      return (
        <>
          {q.length < 2 ? (
            <IntentBarHint>Type at least 2 characters to search.</IntentBarHint>
          ) : anyLoading && totalResults === 0 ? (
            <IntentBarHint>
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </span>
            </IntentBarHint>
          ) : anyError && totalResults === 0 ? (
            <IntentBarHint>
              {uioSearchErrorObj instanceof Error
                ? uioSearchErrorObj.message
                : contentSearchErrorObj instanceof Error
                  ? contentSearchErrorObj.message
                  : "Search failed"}
            </IntentBarHint>
          ) : totalResults === 0 ? (
            <IntentBarHint>No results.</IntentBarHint>
          ) : null}

          {uioResults.length > 0 ? (
            <CommandGroup heading="Memory (UIOs)">
              {uioResults.map((result) => {
                const title = getResultTitle(result);
                const subtitle = getResultSubtitle(result);
                const to = resultToRoute(result);
                return (
                  <CommandItem
                    disabled={!to}
                    key={`${result.type}:${result.id ?? title}`}
                    onSelect={() => {
                      if (!to) return;
                      handleNavigate(to);
                    }}
                    value={`uio ${title} ${subtitle ?? ""} ${String(result.type ?? "")}`}
                  >
                    <div className="flex w-full flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {result.type}
                        </span>
                      </div>
                      {subtitle ? (
                        <span className="line-clamp-2 text-[12px] text-muted-foreground">
                          {subtitle}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}

          {contentResults.filter((r) => r.kind === "message").length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Messages (UEM)">
                {contentResults
                  .filter((r) => r.kind === "message")
                  .slice(0, 8)
                  .map((result) => {
                    const title = formatContentTitle(result);
                    const subtitle = formatContentSubtitle(result);
                    const snippet =
                      typeof result.snippet === "string" ? result.snippet : "";
                    return (
                      <CommandItem
                        key={`uem:${result.id}`}
                        onSelect={() => {
                          void navigator.clipboard
                            .writeText(snippet || title)
                            .then(() => toast.success("Copied snippet"))
                            .catch(() => toast.error("Failed to copy"));
                        }}
                        value={`message ${title} ${snippet}`}
                      >
                        <Mail className="h-4 w-4" />
                        <div className="flex w-full flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-medium">{title}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              message
                            </span>
                          </div>
                          {subtitle ? (
                            <span className="line-clamp-2 text-[12px] text-muted-foreground">
                              {subtitle}
                            </span>
                          ) : null}
                        </div>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </>
          ) : null}

          {contentResults.filter((r) => r.kind === "document").length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Documents (UEM)">
                {contentResults
                  .filter((r) => r.kind === "document")
                  .slice(0, 8)
                  .map((result) => {
                    const title = formatContentTitle(result);
                    const subtitle = formatContentSubtitle(result);
                    const snippet =
                      typeof result.snippet === "string" ? result.snippet : "";
                    return (
                      <CommandItem
                        key={`uem:${result.id}`}
                        onSelect={() => {
                          void navigator.clipboard
                            .writeText(snippet || title)
                            .then(() => toast.success("Copied snippet"))
                            .catch(() => toast.error("Failed to copy"));
                        }}
                        value={`doc ${title} ${snippet}`}
                      >
                        <FileText className="h-4 w-4" />
                        <div className="flex w-full flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-medium">{title}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              document
                            </span>
                          </div>
                          {subtitle ? (
                            <span className="line-clamp-2 text-[12px] text-muted-foreground">
                              {subtitle}
                            </span>
                          ) : null}
                        </div>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </>
          ) : null}

          {continuumResults.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Continuums">
                {continuumResults.map((continuum) => (
                  <CommandItem
                    key={`continuum:${continuum.id}`}
                    onSelect={() => handleNavigate("/dashboard/continuums")}
                    value={`continuum ${continuum.name} ${continuum.description ?? ""}`}
                  >
                    <Sparkles className="h-4 w-4" />
                    <div className="flex w-full flex-col">
                      <span className="truncate font-medium">
                        {continuum.name}
                      </span>
                      {continuum.description ? (
                        <span className="line-clamp-2 text-[12px] text-muted-foreground">
                          {continuum.description}
                        </span>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}

          <CommandSeparator />
          <CommandGroup heading="Commands">
            {registry.global.map((cmd) => (
              <CommandItem
                key={cmd.id}
                onSelect={() => {
                  if (cmd.action) {
                    cmd.action();
                    return;
                  }
                  if (cmd.to) handleNavigate(cmd.to);
                }}
                value={`cmd ${cmd.title} ${cmd.description}`}
              >
                <cmd.icon className="h-4 w-4" />
                <div className="flex w-full flex-col">
                  <span>{cmd.title}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {cmd.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          {showDebug ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Debug">
                <DebugTraceItem label="search" trace={latestTraces.search} />
                <DebugTraceItem label="content" trace={latestTraces.content} />
                <DebugTraceItem
                  label="continuums"
                  trace={latestTraces.continuums}
                />
              </CommandGroup>
            </>
          ) : null}
        </>
      );
    }

    const commandGroups: Array<{ heading: string; items: IntentCommand[] }> = [
      {
        heading:
          mode === "build"
            ? "Continuums"
            : mode === "act"
              ? "Execution"
              : "Surfaces",
        items:
          mode === "build"
            ? registry.build
            : mode === "act"
              ? registry.act
              : registry.inspect,
      },
    ];

    return (
      <>
        {commandGroups.map((group) => (
          <CommandGroup heading={group.heading} key={group.heading}>
            {group.items.map((action) => (
              <CommandItem
                key={action.id}
                onSelect={() => {
                  if (action.action) {
                    action.action();
                    return;
                  }
                  if (action.to) {
                    handleNavigate(action.to);
                  }
                }}
              >
                <action.icon className="h-4 w-4" />
                <div className="flex w-full flex-col">
                  <span>{action.title}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {action.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Global">
          {registry.global.map((cmd) => (
            <CommandItem
              key={cmd.id}
              onSelect={() => {
                if (cmd.action) {
                  cmd.action();
                  return;
                }
                if (cmd.to) handleNavigate(cmd.to);
              }}
              value={`cmd ${cmd.title} ${cmd.description}`}
            >
              <cmd.icon className="h-4 w-4" />
              <div className="flex w-full flex-col">
                <span>{cmd.title}</span>
                <span className="text-[12px] text-muted-foreground">
                  {cmd.description}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
        {showDebug ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Debug">
              <DebugTraceItem label="ask" trace={latestTraces.ask} />
              <DebugTraceItem label="search" trace={latestTraces.search} />
              <DebugTraceItem label="content" trace={latestTraces.content} />
              <DebugTraceItem
                label="continuums"
                trace={latestTraces.continuums}
              />
            </CommandGroup>
          </>
        ) : null}
      </>
    );
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent
        className="max-w-[760px] gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <div className="border-border border-b bg-muted/15">
          <div className="flex items-center gap-2 px-3 py-2">
            <ModePill current={mode} mode="ask" onSelect={setMode} shortcut="⌥1" />
            <ModePill current={mode} mode="find" onSelect={setMode} shortcut="⌥2" />
            <ModePill current={mode} mode="build" onSelect={setMode} shortcut="⌥3" />
            <ModePill current={mode} mode="act" onSelect={setMode} shortcut="⌥4" />
            <ModePill current={mode} mode="inspect" onSelect={setMode} shortcut="⌥5" />
            <div className="ml-auto hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
              <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5">
                {modeMeta.hint}
              </span>
              <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                esc
              </span>
            </div>
          </div>

          {mode === "find" ? (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
              <FilterPill
                active={findFilters.uios}
                label="UIOs"
                onClick={() =>
                  setFindFilters((prev) => ({ ...prev, uios: !prev.uios }))
                }
              />
              <FilterPill
                active={findFilters.messages}
                label="Messages"
                onClick={() =>
                  setFindFilters((prev) => ({
                    ...prev,
                    messages: !prev.messages,
                  }))
                }
              />
              <FilterPill
                active={findFilters.docs}
                label="Docs"
                onClick={() =>
                  setFindFilters((prev) => ({ ...prev, docs: !prev.docs }))
                }
              />
              <FilterPill
                active={findFilters.continuums}
                label="Continuums"
                onClick={() =>
                  setFindFilters((prev) => ({
                    ...prev,
                    continuums: !prev.continuums,
                  }))
                }
              />
              <div className="ml-auto flex items-center gap-2">
                <FilterPill
                  active={showDebug}
                  label="Debug"
                  onClick={() => setShowDebug((prev) => !prev)}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end px-3 pb-2">
              <FilterPill
                active={showDebug}
                label="Debug"
                onClick={() => setShowDebug((prev) => !prev)}
              />
            </div>
          )}
        </div>

        <Command
          className={cn(
            "h-[420px] rounded-none border-0 shadow-none",
            // Slightly denser list in the command bar
            "[&_[cmdk-list]]:max-h-[340px]"
          )}
        >
          <CommandInput
            autoFocus
            ref={(node) => {
              inputRef.current = node;
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (mode === "ask") {
                e.preventDefault();
                void handleAsk();
              }
            }}
            onValueChange={(value) => {
              setQuery(value);
              setAskResult(null);
            }}
            placeholder={modeMeta.placeholder}
            value={query}
          />
          <CommandList>
            {renderBody()}
          </CommandList>
        </Command>

        <div className="flex items-center justify-between border-border border-t bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Open with</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
            <span className="hidden sm:inline">or</span>
            <span className="inline-flex items-center gap-1 font-mono sm:hidden">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded border border-border/70 bg-muted/20 px-2 py-0.5 font-mono">
              {user?.org_id ?? "org"}
            </span>
            {showDebug ? (
              <span className="rounded border border-border/70 bg-muted/20 px-2 py-0.5 font-mono">
                {pathname}
              </span>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DebugTraceItem({
  label,
  trace,
}: {
  label: string;
  trace?: TraceSnapshot;
}) {
  if (!trace) {
    return (
      <CommandItem disabled value={`trace ${label} none`}>
        <span className="font-mono text-[11px] text-muted-foreground">
          {label}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          —
        </span>
      </CommandItem>
    );
  }

  const statusLabel = trace.status ? String(trace.status) : "—";
  const requestId = trace.requestId ?? "";
  const duration = Number.isFinite(trace.durationMs)
    ? `${trace.durationMs}ms`
    : "—";

  return (
    <CommandItem
      onSelect={() => {
        if (!requestId) return;
        void navigator.clipboard
          .writeText(requestId)
          .then(() => toast.success("Request ID copied"))
          .catch(() => toast.error("Failed to copy"));
      }}
      disabled={!requestId}
      value={`trace ${label} ${requestId} ${statusLabel}`}
    >
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <span>{statusLabel}</span>
        <span>{duration}</span>
        {requestId ? <span className="opacity-80">req {requestId}</span> : null}
      </span>
    </CommandItem>
  );
}
