import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const store = useAdminAuthStore.getState();
    // Always check; do not trust in-memory state across hot reloads.
    await store.checkAuth();
    if (useAdminAuthStore.getState().me) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const { isLoading, error, loginWithEmail, clearError } = useAdminAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [persist, setPersist] = useState(true);

  const domainHint = useMemo(() => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) return null;
    const domain = trimmed.split("@")[1] ?? "";
    if (!domain) return null;
    if (domain === "drovi.co") return { ok: true, text: "drovi.co" };
    return { ok: false, text: domain };
  }, [email]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await loginWithEmail(email, password, { persist });
      toast.success("Signed in");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    }
  };

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(0,0,0,0.10),transparent_55%),radial-gradient(circle_at_80%_20%,rgba(0,112,243,0.12),transparent_50%),radial-gradient(circle_at_50%_90%,rgba(0,0,0,0.06),transparent_55%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-24 top-[-12rem] h-[28rem] rotate-6 bg-[linear-gradient(to_right,transparent,rgba(0,0,0,0.04),transparent)] blur-2xl"
      />

      <div className="relative w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-foreground" />
              <div className="text-sm font-medium tracking-tight">Drovi Admin</div>
            </div>
            <div className="text-muted-foreground text-xs">
              Operator access only. Email/password, `@drovi.co`.
            </div>
          </div>
          <div className="hidden text-right text-xs text-muted-foreground sm:block">
            <div>Live KPIs</div>
            <div>Jobs and Connectors</div>
          </div>
        </div>

        <Card className="border-border/70 bg-card/70 backdrop-blur">
          <CardHeader className="space-y-1">
            <CardTitle className="text-[15px]">Sign in</CardTitle>
            <div className="text-muted-foreground text-xs">
              Use your `@drovi.co` email and the current admin password.
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@drovi.co"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                />
                {domainHint ? (
                  <div
                    className={cn(
                      "text-xs",
                      domainHint.ok ? "text-muted-foreground" : "text-destructive"
                    )}
                  >
                    Domain: {domainHint.text}
                    {!domainHint.ok ? " (not allowed)" : ""}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••••••••"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                />
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
                <input
                  checked={persist}
                  className="accent-foreground"
                  onChange={(ev) => setPersist(ev.target.checked)}
                  type="checkbox"
                />
                Keep me signed in on this device
              </label>

              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              ) : null}

              <Button className="w-full" disabled={isLoading} type="submit">
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-muted-foreground text-[11px]">
          If you can’t sign in, set `ADMIN_PASSWORD` in `drovi-intelligence/.env`
          and restart the stack.
        </div>
      </div>
    </div>
  );
}
