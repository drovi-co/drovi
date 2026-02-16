import { useSyncExternalStore } from "react";

type ApiReachabilityState = {
  reachable: boolean;
  lastError: string | null;
  lastCheckedAt: number | null;
};

let state: ApiReachabilityState = {
  reachable: true,
  lastError: null,
  lastCheckedAt: null,
};

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function updateState(next: Partial<ApiReachabilityState>) {
  state = { ...state, ...next };
  emitChange();
}

export function markApiReachable() {
  if (!state.reachable || state.lastError) {
    updateState({
      reachable: true,
      lastError: null,
      lastCheckedAt: Date.now(),
    });
  }
}

export function markApiUnreachable(error?: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Network error";

  updateState({
    reachable: false,
    lastError: message,
    lastCheckedAt: Date.now(),
  });
}

export function getApiReachability() {
  return state;
}

export function subscribeApiReachability(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApiReachability() {
  return useSyncExternalStore(
    subscribeApiReachability,
    getApiReachability,
    getApiReachability
  );
}
