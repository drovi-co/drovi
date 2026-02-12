import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
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
  const t = useT();
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
      toast.success(t("admin.login.toasts.signedIn"));
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.login.toasts.signInFailed")
      );
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
              <div className="font-medium text-sm tracking-tight">
                {t("admin.appName")}
              </div>
            </div>
            <div className="text-muted-foreground text-xs">
              {t("admin.login.operatorOnly")}
            </div>
          </div>
          <div className="hidden text-right text-muted-foreground text-xs sm:block">
            <div>{t("admin.login.kpiHint")}</div>
            <div>{t("admin.login.opsHint")}</div>
          </div>
        </div>

        <Card className="border-border/70 bg-card/70 backdrop-blur">
          <CardHeader className="space-y-1">
            <CardTitle className="text-[15px]">
              {t("admin.login.title")}
            </CardTitle>
            <div className="text-muted-foreground text-xs">
              {t("admin.login.description")}
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">{t("admin.login.fields.email")}</Label>
                <Input
                  autoComplete="email"
                  id="email"
                  inputMode="email"
                  onChange={(ev) => setEmail(ev.target.value)}
                  placeholder={t("admin.login.placeholders.email")}
                  value={email}
                />
                {domainHint ? (
                  <div
                    className={cn(
                      "text-xs",
                      domainHint.ok
                        ? "text-muted-foreground"
                        : "text-destructive"
                    )}
                  >
                    {t("admin.login.domain.label", { domain: domainHint.text })}
                    {domainHint.ok
                      ? ""
                      : ` (${t("admin.login.domain.notAllowed")})`}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">
                  {t("admin.login.fields.password")}
                </Label>
                <Input
                  autoComplete="current-password"
                  id="password"
                  onChange={(ev) => setPassword(ev.target.value)}
                  placeholder="••••••••••••••••"
                  type="password"
                  value={password}
                />
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2 text-muted-foreground text-xs">
                <input
                  checked={persist}
                  className="accent-foreground"
                  onChange={(ev) => setPersist(ev.target.checked)}
                  type="checkbox"
                />
                {t("admin.login.keepSignedIn")}
              </label>

              {error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
                  {error}
                </div>
              ) : null}

              <Button className="w-full" disabled={isLoading} type="submit">
                {isLoading
                  ? t("admin.login.submitting")
                  : t("common.actions.signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4 text-center text-[11px] text-muted-foreground">
          {t("admin.login.troubleshoot")}
        </div>
      </div>
    </div>
  );
}
