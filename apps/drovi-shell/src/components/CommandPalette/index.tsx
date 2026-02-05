import { Command } from "cmdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  MessageCircle,
  Terminal,
  Navigation,
  ArrowRight,
  Loader2,
  X,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Clock,
  User,
  FileText,
  GitCommit,
  Shield,
  Filter,
  Calendar,
  Target,
} from "lucide-react";
import { useUIStore, type CommandMode } from "../../store/uiStore";
import { useOrgId } from "../../store/authStore";
import { intelligenceEndpoints, type AskStreamEvent } from "../../api/endpoints/intelligence";
import { uioEndpoints } from "../../api/endpoints/uios";
import type { SearchResponse, UIOType } from "../../api/schemas";

interface StreamingState {
  isStreaming: boolean;
  truthResults: Array<{ id: string; type: string; title: string; confidence: number }>;
  citations: Array<{ id: string; source: string; snippet: string }>;
  reasoning: string;
  error: string | null;
}

const MODE_CONFIG: Record<
  CommandMode,
  { icon: typeof Search; placeholder: string; hint: string; color: string }
> = {
  ask: {
    icon: MessageCircle,
    placeholder: "Ask your memory...",
    hint: "AI-powered search with reasoning",
    color: "var(--color-accent)",
  },
  command: {
    icon: Terminal,
    placeholder: "Run a command...",
    hint: "Execute actions",
    color: "var(--color-commitment)",
  },
  search: {
    icon: Search,
    placeholder: "Search everything...",
    hint: "Hybrid search across all UIOs",
    color: "var(--color-task)",
  },
  navigate: {
    icon: Navigation,
    placeholder: "Go to...",
    hint: "Navigate to views",
    color: "var(--color-decision)",
  },
};

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  commitment: GitCommit,
  decision: CheckCircle2,
  task: FileText,
  risk: AlertTriangle,
  contact: User,
  claim: BookOpen,
};

const TYPE_COLORS: Record<string, string> = {
  commitment: "var(--color-commitment)",
  decision: "var(--color-decision)",
  task: "var(--color-task)",
  risk: "var(--color-risk)",
  contact: "var(--color-contact)",
  claim: "var(--color-text-secondary)",
};

export function CommandPalette() {
  const {
    commandPaletteOpen,
    commandMode,
    commandQuery,
    commandLoading,
    closeCommandPalette,
    setCommandMode,
    setCommandQuery,
    setCommandLoading,
  } = useUIStore();

  const orgId = useOrgId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [searchResults, setSearchResults] = useState<SearchResponse["results"]>([]);
  const [searchTypeFilters, setSearchTypeFilters] = useState<UIOType[]>([]);
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isStreaming: false,
    truthResults: [],
    citations: [],
    reasoning: "",
    error: null,
  });

  // Focus input when palette opens
  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global open shortcut
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          useUIStore.getState().openCommandPalette("ask");
        }
        return;
      }

      if (!commandPaletteOpen) return;

      // Tab to cycle modes (forward)
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const modes: CommandMode[] = ["ask", "command", "search", "navigate"];
        const currentIndex = modes.indexOf(commandMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        setCommandMode(modes[nextIndex]);
        return;
      }

      // Shift+Tab to cycle modes (backward)
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const modes: CommandMode[] = ["ask", "command", "search", "navigate"];
        const currentIndex = modes.indexOf(commandMode);
        const prevIndex = (currentIndex - 1 + modes.length) % modes.length;
        setCommandMode(modes[prevIndex]);
        return;
      }

      // Escape to close
      if (e.key === "Escape") {
        e.preventDefault();
        closeCommandPalette();
        return;
      }

      // Vim-style navigation: j/k for down/up (only when input is not focused or at start/end)
      const activeElement = document.activeElement;
      const isInputFocused = activeElement?.tagName === "INPUT";
      const inputValue = (activeElement as HTMLInputElement)?.value || "";
      const selectionStart = (activeElement as HTMLInputElement)?.selectionStart ?? 0;

      // Allow j/k navigation when: not in input, or input is empty
      if (e.key === "j" && (!isInputFocused || inputValue === "")) {
        e.preventDefault();
        // Simulate ArrowDown
        const downEvent = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          bubbles: true,
        });
        document.querySelector("[cmdk-list]")?.dispatchEvent(downEvent);
        return;
      }

      if (e.key === "k" && (!isInputFocused || inputValue === "")) {
        e.preventDefault();
        // Simulate ArrowUp
        const upEvent = new KeyboardEvent("keydown", {
          key: "ArrowUp",
          code: "ArrowUp",
          bubbles: true,
        });
        document.querySelector("[cmdk-list]")?.dispatchEvent(upEvent);
        return;
      }

      // Ctrl+j / Ctrl+k for navigation (works even when input is focused)
      if ((e.ctrlKey || e.metaKey) && e.key === "j") {
        e.preventDefault();
        const downEvent = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          bubbles: true,
        });
        document.querySelector("[cmdk-list]")?.dispatchEvent(downEvent);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        // Note: Cmd+K is already used for toggle, so we use Ctrl+K on Mac for navigation
        // This is handled by the global Cmd+K above
        return;
      }

      // Cmd+Enter to open selected item in detail panel
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        const selectedItem = document.querySelector("[cmdk-item][data-selected='true']");
        if (selectedItem) {
          const itemValue = selectedItem.getAttribute("data-value");
          if (itemValue) {
            // Open detail panel for this item
            const { openDetailPanel } = useUIStore.getState();
            // For now, just log - will integrate with actual detail panel
            console.log("Open in detail panel:", itemValue);
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, commandMode, closeCommandPalette, setCommandMode]);

  // Handle search
  const handleSearch = useCallback(
    async (query: string, typeFilters: UIOType[] = []) => {
      if (!query.trim() || !orgId) return;

      setCommandLoading(true);
      setSearchResults([]);

      try {
        const response = await intelligenceEndpoints.search({
          query,
          organization_id: orgId,
          include_graph_context: true,
          limit: 20,
          types: typeFilters.length > 0 ? typeFilters : undefined,
        });
        setSearchResults(response.results);
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setCommandLoading(false);
      }
    },
    [orgId, setCommandLoading]
  );

  // Toggle type filter
  const toggleTypeFilter = useCallback((type: UIOType) => {
    setSearchTypeFilters((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  // Handle selecting a search result - fetch details and open panel
  const handleSelectResult = useCallback(
    async (resultId: string) => {
      if (!orgId) return;

      try {
        const uioDetail = await uioEndpoints.get(resultId, orgId);
        const { openDetailPanel, closeCommandPalette } = useUIStore.getState();
        openDetailPanel(uioDetail);
        closeCommandPalette();
      } catch (error) {
        console.error("Failed to fetch UIO details:", error);
      }
    },
    [orgId]
  );

  // Handle ask (streaming)
  const handleAsk = useCallback(
    async (query: string) => {
      if (!query.trim() || !orgId) return;

      // Cancel any existing stream
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      setStreamingState({
        isStreaming: true,
        truthResults: [],
        citations: [],
        reasoning: "",
        error: null,
      });

      try {
        const stream = intelligenceEndpoints.askStream({
          query,
          organization_id: orgId,
          mode: "truth+reasoning",
          include_citations: true,
        });

        for await (const event of stream) {
          if (abortControllerRef.current?.signal.aborted) break;

          switch (event.event) {
            case "truth": {
              const data = event.data as {
                results: Array<{ id: string; type: string; title: string; confidence: number }>;
                citations: Array<{ id: string; source: string; snippet: string }>;
              };
              setStreamingState((prev) => ({
                ...prev,
                truthResults: data.results || [],
                citations: data.citations || [],
              }));
              break;
            }
            case "token": {
              const data = event.data as { token: string };
              setStreamingState((prev) => ({
                ...prev,
                reasoning: prev.reasoning + data.token,
              }));
              break;
            }
            case "done": {
              setStreamingState((prev) => ({
                ...prev,
                isStreaming: false,
              }));
              break;
            }
            case "error": {
              const data = event.data as { message: string };
              setStreamingState((prev) => ({
                ...prev,
                isStreaming: false,
                error: data.message,
              }));
              break;
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          setStreamingState((prev) => ({
            ...prev,
            isStreaming: false,
            error: error instanceof Error ? error.message : "Ask failed",
          }));
        }
      }
    },
    [orgId]
  );

  // Handle submit based on mode
  const handleSubmit = useCallback(
    (query: string) => {
      if (commandMode === "ask") {
        handleAsk(query);
      } else if (commandMode === "search") {
        handleSearch(query);
      }
    },
    [commandMode, handleAsk, handleSearch]
  );

  // Debounced search for search mode
  useEffect(() => {
    if (commandMode !== "search" || !commandQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      handleSearch(commandQuery, searchTypeFilters);
    }, 300);

    return () => clearTimeout(timer);
  }, [commandQuery, commandMode, handleSearch, searchTypeFilters]);

  const config = MODE_CONFIG[commandMode];
  const ModeIcon = config.icon;

  if (!commandPaletteOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="command-palette__overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeCommandPalette}
      >
        <motion.div
          className="command-palette"
          initial={{ opacity: 0, scale: 0.96, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -20 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Command shouldFilter={false} loop>
            {/* Input Section */}
            <div className="command-palette__input-wrapper">
              <div className="command-palette__mode-tabs">
                {(Object.keys(MODE_CONFIG) as CommandMode[]).map((mode) => {
                  const Icon = MODE_CONFIG[mode].icon;
                  return (
                    <button
                      key={mode}
                      className={`command-palette__mode-tab ${
                        commandMode === mode ? "command-palette__mode-tab--active" : ""
                      }`}
                      onClick={() => setCommandMode(mode)}
                      style={
                        commandMode === mode
                          ? { borderColor: MODE_CONFIG[mode].color }
                          : undefined
                      }
                    >
                      <Icon size={14} />
                      <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                    </button>
                  );
                })}
              </div>

              <div className="command-palette__input-row">
                <ModeIcon
                  size={18}
                  style={{ color: config.color, flexShrink: 0 }}
                />
                <Command.Input
                  ref={inputRef}
                  value={commandQuery}
                  onValueChange={setCommandQuery}
                  placeholder={config.placeholder}
                  className="command-palette__input"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commandMode === "ask") {
                      e.preventDefault();
                      handleSubmit(commandQuery);
                    }
                  }}
                />
                {commandLoading && (
                  <Loader2 size={16} className="command-palette__spinner" />
                )}
                <button
                  className="command-palette__close"
                  onClick={closeCommandPalette}
                  aria-label="Close command palette"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="command-palette__hints">
                <span className="kbd">j</span>
                <span className="kbd">k</span>
                <span className="command-palette__hint-text">navigate</span>
                <span className="kbd">Tab</span>
                <span className="command-palette__hint-text">mode</span>
                <span className="kbd">↵</span>
                <span className="command-palette__hint-text">
                  {commandMode === "ask" ? "ask" : "select"}
                </span>
                <span className="kbd">⌘↵</span>
                <span className="command-palette__hint-text">detail</span>
                <span className="kbd">Esc</span>
                <span className="command-palette__hint-text">close</span>
              </div>
            </div>

            {/* Results Section */}
            <Command.List className="command-palette__results">
              {/* Ask Mode - Streaming Results */}
              {commandMode === "ask" && (
                <AskResults
                  streamingState={streamingState}
                  onSelectResult={handleSelectResult}
                />
              )}

              {/* Search Mode - Search Results */}
              {commandMode === "search" && (
                <SearchResults
                  results={searchResults}
                  loading={commandLoading}
                  query={commandQuery}
                  typeFilters={searchTypeFilters}
                  onToggleTypeFilter={toggleTypeFilter}
                  onSelectResult={handleSelectResult}
                />
              )}

              {/* Command Mode - Quick Actions */}
              {commandMode === "command" && (
                <CommandResults query={commandQuery} />
              )}

              {/* Navigate Mode - Navigation Options */}
              {commandMode === "navigate" && (
                <NavigateResults query={commandQuery} />
              )}
            </Command.List>
          </Command>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Ask Results Component
function AskResults({ streamingState, onSelectResult }: { streamingState: StreamingState; onSelectResult: (id: string) => void }) {
  const { openEvidenceLens, closeCommandPalette } = useUIStore();
  const { isStreaming, truthResults, citations, reasoning, error } = streamingState;

  const handleOpenEvidence = (evidenceId: string) => {
    openEvidenceLens(evidenceId);
    closeCommandPalette();
  };

  if (error) {
    return (
      <div className="command-palette__error">
        <AlertTriangle size={16} />
        <span>{error}</span>
      </div>
    );
  }

  if (!isStreaming && truthResults.length === 0 && !reasoning) {
    return (
      <Command.Empty className="command-palette__empty">
        <MessageCircle size={32} style={{ opacity: 0.3 }} />
        <p>Ask anything about your memory</p>
        <p className="command-palette__empty-hint">
          Try "What commitments do I have this week?" or "What did we decide about the API?"
        </p>
      </Command.Empty>
    );
  }

  return (
    <div className="streaming-result">
      {/* Phase A: Truth Results */}
      {truthResults.length > 0 && (
        <div className="streaming-result__truth">
          <div className="streaming-result__section-title">
            <Shield size={14} />
            <span>Grounded Results</span>
            <span className="streaming-result__badge">{truthResults.length}</span>
          </div>
          <div className="streaming-result__items">
            {truthResults.map((result) => {
              const Icon = TYPE_ICONS[result.type] || BookOpen;
              const color = TYPE_COLORS[result.type] || "var(--color-text-secondary)";
              return (
                <Command.Item
                  key={result.id}
                  value={result.id}
                  className="result-item"
                  onSelect={() => onSelectResult(result.id)}
                >
                  <div
                    className="result-item__icon"
                    style={{ color, backgroundColor: `${color}15` }}
                  >
                    <Icon size={14} />
                  </div>
                  <div className="result-item__content">
                    <span className="result-item__title">{result.title}</span>
                    <span className="result-item__type">{result.type}</span>
                  </div>
                  <ConfidenceBadge confidence={result.confidence} />
                  <ArrowRight size={14} className="result-item__arrow" />
                </Command.Item>
              );
            })}
          </div>
        </div>
      )}

      {/* Phase B: Reasoning */}
      {(reasoning || isStreaming) && (
        <div className="streaming-result__reasoning">
          <div className="streaming-result__section-title">
            <MessageCircle size={14} />
            <span>Reasoning</span>
            {isStreaming && <Loader2 size={12} className="streaming-result__streaming-indicator" />}
          </div>
          <div className="streaming-result__text">
            {reasoning || <span className="streaming-result__placeholder">Thinking...</span>}
            {isStreaming && <span className="streaming-result__cursor" />}
          </div>
        </div>
      )}

      {/* Citations */}
      {citations.length > 0 && (
        <div className="streaming-result__citations">
          <div className="streaming-result__section-title">
            <BookOpen size={14} />
            <span>Sources</span>
            <span className="streaming-result__badge">{citations.length}</span>
          </div>
          <div className="streaming-result__citation-list">
            {citations.map((citation, index) => (
              <button
                key={citation.id}
                className="streaming-result__citation"
                onClick={() => handleOpenEvidence(citation.id)}
                title={citation.snippet}
              >
                <span className="streaming-result__citation-number">{index + 1}</span>
                <span className="streaming-result__citation-source">{citation.source}</span>
                <span className="streaming-result__citation-snippet">{citation.snippet}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Available UIO types for filtering
const FILTER_TYPES: { type: UIOType; label: string }[] = [
  { type: "commitment", label: "Commitments" },
  { type: "decision", label: "Decisions" },
  { type: "task", label: "Tasks" },
  { type: "risk", label: "Risks" },
  { type: "contact", label: "Contacts" },
  { type: "claim", label: "Claims" },
];

// Search Results Component
function SearchResults({
  results,
  loading,
  query,
  typeFilters,
  onToggleTypeFilter,
  onSelectResult,
}: {
  results: SearchResponse["results"];
  loading: boolean;
  query: string;
  typeFilters: UIOType[];
  onToggleTypeFilter: (type: UIOType) => void;
  onSelectResult: (id: string) => void;
}) {
  return (
    <div className="search-results">
      {/* Type Filters */}
      <div className="search-results__filters">
        <Filter size={14} className="search-results__filter-icon" />
        {FILTER_TYPES.map(({ type, label }) => {
          const isActive = typeFilters.includes(type);
          const color = TYPE_COLORS[type] || "var(--color-text-secondary)";
          return (
            <button
              key={type}
              className={`search-results__filter-pill ${isActive ? "search-results__filter-pill--active" : ""}`}
              style={isActive ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
              onClick={() => onToggleTypeFilter(type)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="command-palette__loading">
          <Loader2 size={20} className="command-palette__spinner" />
          <span>Searching...</span>
        </div>
      ) : !query.trim() ? (
        <Command.Empty className="command-palette__empty">
          <Search size={32} style={{ opacity: 0.3 }} />
          <p>Start typing to search</p>
          <p className="command-palette__empty-hint">
            Search across commitments, decisions, tasks, and more
          </p>
        </Command.Empty>
      ) : results.length === 0 ? (
        <Command.Empty className="command-palette__empty">
          <Search size={32} style={{ opacity: 0.3 }} />
          <p>No results found</p>
          <p className="command-palette__empty-hint">
            {typeFilters.length > 0
              ? "Try removing some filters or a different search term"
              : "Try a different search term"}
          </p>
        </Command.Empty>
      ) : (
        <Command.Group heading={`${results.length} results`}>
          {results.map((result) => {
            const Icon = TYPE_ICONS[result.type] || BookOpen;
            const color = TYPE_COLORS[result.type] || "var(--color-text-secondary)";
            const matchSource = result.match_source;
            return (
              <Command.Item
                key={result.id}
                value={result.id}
                className="result-item"
                onSelect={() => onSelectResult(result.id)}
              >
                <div
                  className="result-item__icon"
                  style={{ color, backgroundColor: `${color}15` }}
                >
                  <Icon size={14} />
                </div>
                <div className="result-item__content">
                  <span className="result-item__title">{result.title}</span>
                  <div className="result-item__meta">
                    <span className="result-item__type">{result.type}</span>
                    {matchSource && (
                      <span className="result-item__match-source">
                        via {matchSource}
                      </span>
                    )}
                    {result.connections && result.connections.length > 0 && (
                      <span className="result-item__connections">
                        +{result.connections.length} linked
                      </span>
                    )}
                  </div>
                </div>
                <ConfidenceBadge confidence={result.score} />
                <ArrowRight size={14} className="result-item__arrow" />
              </Command.Item>
            );
          })}
        </Command.Group>
      )}
    </div>
  );
}

// Command Results Component
function CommandResults({ query }: { query: string }) {
  const commands = [
    { id: "sync", label: "Sync all sources", icon: Loader2, shortcut: "⌘S" },
    { id: "analyze", label: "Analyze clipboard", icon: FileText, shortcut: "⌘A" },
    { id: "brief", label: "Get daily brief", icon: BookOpen, shortcut: "⌘B" },
    { id: "connections", label: "Manage connections", icon: Shield, shortcut: "⌘," },
  ];

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <Command.Empty className="command-palette__empty">
        <Terminal size={32} style={{ opacity: 0.3 }} />
        <p>No commands found</p>
      </Command.Empty>
    );
  }

  return (
    <Command.Group heading="Commands">
      {filtered.map((cmd) => (
        <Command.Item
          key={cmd.id}
          value={cmd.id}
          className="result-item"
          onSelect={() => {
            console.log("Execute command:", cmd.id);
          }}
        >
          <div className="result-item__icon result-item__icon--command">
            <cmd.icon size={14} />
          </div>
          <div className="result-item__content">
            <span className="result-item__title">{cmd.label}</span>
          </div>
          <span className="kbd">{cmd.shortcut}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}

// Navigate Results Component
function NavigateResults({ query }: { query: string }) {
  const { setActiveView, closeCommandPalette } = useUIStore();

  const views = [
    { id: "intent", label: "Intent Bar", icon: MessageCircle },
    { id: "deck", label: "Command Deck", icon: Terminal },
    { id: "connections", label: "Connections", icon: Shield },
    { id: "settings", label: "Settings", icon: FileText },
  ] as const;

  const filtered = views.filter((view) =>
    view.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <Command.Group heading="Navigate to">
      {filtered.map((view) => (
        <Command.Item
          key={view.id}
          value={view.id}
          className="result-item"
          onSelect={() => {
            setActiveView(view.id);
            closeCommandPalette();
          }}
        >
          <div className="result-item__icon result-item__icon--navigate">
            <view.icon size={14} />
          </div>
          <div className="result-item__content">
            <span className="result-item__title">{view.label}</span>
          </div>
          <ArrowRight size={14} className="result-item__arrow" />
        </Command.Item>
      ))}
    </Command.Group>
  );
}

// Confidence Badge Component
function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level =
    confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const percentage = Math.round(confidence * 100);

  return (
    <span className={`confidence-badge confidence-badge--${level}`}>
      {percentage}%
    </span>
  );
}

export default CommandPalette;
