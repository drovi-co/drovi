import { create } from "zustand";

export type ApiTraceKind = "ok" | "error";

export interface ApiTraceEntry {
  kind: ApiTraceKind;
  at: number;
  method: string;
  endpoint: string;
  url: string;
  status: number;
  requestId?: string;
  durationMs: number;
}

interface ApiTraceState {
  traces: ApiTraceEntry[];
  record: (entry: ApiTraceEntry) => void;
  clear: () => void;
}

const MAX_TRACES = 80;

export const useApiTraceStore = create<ApiTraceState>((set) => ({
  traces: [],
  record: (entry) =>
    set((state) => ({
      traces: [entry, ...state.traces].slice(0, MAX_TRACES),
    })),
  clear: () => set({ traces: [] }),
}));

export function recordApiTrace(entry: ApiTraceEntry) {
  useApiTraceStore.getState().record(entry);
}

export function getLastTraceForEndpoint(endpoint: string): ApiTraceEntry | null {
  const traces = useApiTraceStore.getState().traces;
  return traces.find((t) => t.endpoint === endpoint) ?? null;
}

