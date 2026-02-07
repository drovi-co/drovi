import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  ClipboardList,
  Code2,
  Eye,
  Gauge,
  Loader2,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
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
import { askAPI, searchAPI, type AskResponse, type SearchResult } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

type IntentBarMode = "ask" | "find" | "build" | "act" | "inspect";

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

export function IntentBar() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<IntentBarMode>("ask");
  const [query, setQuery] = useState("");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [asking, setAsking] = useState(false);

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
  }, [open]);

  // Clear ask results when leaving Ask mode.
  useEffect(() => {
    if (mode === "ask") return;
    setAskResult(null);
    setAsking(false);
  }, [mode]);

  const {
    data: searchResponse,
    isLoading: searching,
    isError: searchError,
    error: searchErrorObj,
  } = useQuery({
    queryKey: ["intent-bar-search", user?.org_id ?? "none", debouncedQuery],
    queryFn: () =>
      searchAPI.search({
        query: debouncedQuery,
        include_graph_context: false,
        limit: 14,
      }),
    enabled:
      open &&
      mode === "find" &&
      Boolean(user?.org_id) &&
      debouncedQuery.trim().length >= 2,
    staleTime: 10_000,
  });

  const results = searchResponse?.results ?? [];

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
        userId: user.user_id,
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

  const actions = useMemo(
    () => [
      {
        id: "go-console",
        title: "Open Console",
        description: "Primary intelligence view",
        icon: Gauge,
        to: "/dashboard/console",
      },
      {
        id: "go-builder",
        title: "Open Continuum Builder",
        description: "Build continuums from DSL or natural language",
        icon: Code2,
        to: "/dashboard/builder",
      },
      {
        id: "go-exchange",
        title: "Browse Continuum Exchange",
        description: "Install curated continuums",
        icon: ClipboardList,
        to: "/dashboard/exchange",
      },
      {
        id: "go-reality",
        title: "Reality Stream",
        description: "Every change, chronologically",
        icon: Activity,
        to: "/dashboard/reality-stream",
      },
      {
        id: "go-actuations",
        title: "Actuations",
        description: "Stage and execute actions",
        icon: Zap,
        to: "/dashboard/actuations",
      },
    ],
    []
  );

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
        return (
          <>
            <CommandGroup heading="Answer">
              <div className="px-2 py-2 text-[13px] leading-relaxed text-foreground">
                <div className="whitespace-pre-wrap">{askResult.answer}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                    {askResult.intent}
                  </span>
                  <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                    {citations.length} cite
                    {citations.length === 1 ? "" : "s"}
                  </span>
                  <span className="rounded border border-border/70 bg-muted/30 px-2 py-0.5 font-mono">
                    {Math.round((askResult.duration_seconds ?? 0) * 1000)}ms
                  </span>
                </div>
              </div>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Evidence">
              {citations.length === 0 ? (
                <IntentBarHint>No evidence returned.</IntentBarHint>
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
      if (searchError) {
        return (
          <IntentBarHint>
            {searchErrorObj instanceof Error
              ? searchErrorObj.message
              : "Search failed"}
          </IntentBarHint>
        );
      }

      if (searching && results.length === 0) {
        return (
          <IntentBarHint>
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </span>
          </IntentBarHint>
        );
      }

      return (
        <>
          {debouncedQuery.trim().length < 2 ? (
            <IntentBarHint>Type at least 2 characters to search.</IntentBarHint>
          ) : results.length === 0 ? (
            <IntentBarHint>No results.</IntentBarHint>
          ) : null}
          {results.length > 0 ? (
            <CommandGroup heading="Top Matches">
              {results.map((result) => {
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
        </>
      );
    }

    const groups: Array<{ heading: string; items: typeof actions }> = [
      {
        heading:
          mode === "build"
            ? "Continuums"
            : mode === "act"
              ? "Execution"
              : "Surfaces",
        items: actions,
      },
    ];

    return (
      <>
        {groups.map((group) => (
          <CommandGroup heading={group.heading} key={group.heading}>
            {group.items.map((action) => (
              <CommandItem
                key={action.id}
                onSelect={() => handleNavigate(action.to)}
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
      </>
    );
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent
        className="max-w-[760px] gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <div className="flex items-center gap-2 border-border border-b bg-muted/15 px-3 py-2">
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
              if (mode !== "ask") return;
              e.preventDefault();
              void handleAsk();
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
