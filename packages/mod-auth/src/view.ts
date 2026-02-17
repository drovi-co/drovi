import { useCallback, useState } from "react";

export type AuthView = "sign-in" | "sign-up";

interface ResolveAuthViewInput {
  search?: string | URLSearchParams | null;
  defaultView?: AuthView;
}

function toSearchParams(
  search: ResolveAuthViewInput["search"]
): URLSearchParams {
  if (search instanceof URLSearchParams) {
    return search;
  }
  if (typeof search === "string") {
    const normalized = search.startsWith("?") ? search.slice(1) : search;
    return new URLSearchParams(normalized);
  }
  return new URLSearchParams();
}

export function resolveAuthView({
  search,
  defaultView = "sign-in",
}: ResolveAuthViewInput = {}): AuthView {
  const params = toSearchParams(search);
  const mode = params.get("mode");
  const invite = params.get("invite");

  if (mode === "sign-up" || Boolean(invite)) {
    return "sign-up";
  }
  return defaultView;
}

export function useAuthView(input: ResolveAuthViewInput = {}) {
  const [view, setView] = useState<AuthView>(() => resolveAuthView(input));

  const showSignIn = useCallback(() => setView("sign-in"), []);
  const showSignUp = useCallback(() => setView("sign-up"), []);

  return {
    view,
    setView,
    showSignIn,
    showSignUp,
  };
}
