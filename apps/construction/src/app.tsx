import { createAskModule } from "@memorystack/mod-ask";
import { createAuthModule } from "@memorystack/mod-auth";
import { createConsoleModule } from "@memorystack/mod-console";
import { createContinuumsModule } from "@memorystack/mod-continuums";
import { createDriveModule } from "@memorystack/mod-drive";
import { createEvidenceModule } from "@memorystack/mod-evidence";
import type { DroviModule } from "@memorystack/mod-kit";
import { createOnboardingModule } from "@memorystack/mod-onboarding";
import { createSourcesModule } from "@memorystack/mod-sources";
import { createTeamsModule } from "@memorystack/mod-teams";
import { applyThemePack } from "@memorystack/ui-theme";
import {
  getVerticalPreset,
  resolveModulesForVertical,
  useVertical,
  type VerticalId,
  VerticalRuntimeProvider,
} from "@memorystack/vertical-runtime";
import { useEffect, useMemo } from "react";

const MODULE_FACTORIES: Record<string, () => DroviModule> = {
  "mod-auth": () => createAuthModule(),
  "mod-onboarding": () => createOnboardingModule(),
  "mod-sources": () => createSourcesModule(),
  "mod-teams": () => createTeamsModule(),
  "mod-drive": () => createDriveModule(),
  "mod-evidence": () => createEvidenceModule(),
  "mod-ask": () => createAskModule(),
  "mod-console": () => createConsoleModule(),
  "mod-continuums": () => createContinuumsModule(),
};

function pickOrgId(): string {
  if (typeof window === "undefined") {
    return "org_test";
  }
  return (
    window.localStorage.getItem("drovi.org.id") ||
    window.localStorage.getItem("drovi.org") ||
    "org_test"
  );
}

function VerticalShellBody({ verticalId }: { verticalId: VerticalId }) {
  const runtime = useVertical();
  const preset = useMemo(() => getVerticalPreset(verticalId), [verticalId]);

  const modules = useMemo(
    () =>
      preset.moduleIds
        .map((moduleId) => MODULE_FACTORIES[moduleId])
        .filter((factory): factory is () => DroviModule => Boolean(factory))
        .map((factory) => factory()),
    [preset.moduleIds]
  );

  const resolved = useMemo(
    () =>
      resolveModulesForVertical(
        {
          modules,
          appOverrides: preset.appOverrides,
        },
        runtime
      ),
    [modules, preset.appOverrides, runtime]
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-6 py-10">
        <header className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
            Vertical Shell
          </p>
          <h1 className="mt-2 font-semibold text-3xl">{preset.title}</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Preset-driven module composition with backend manifest gating.
          </p>
          <div className="mt-4 grid gap-2 text-muted-foreground text-sm sm:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">Theme pack:</span>{" "}
              {preset.themePack}
            </div>
            <div>
              <span className="font-medium text-foreground">Modules:</span>{" "}
              {resolved.length}
            </div>
            <div>
              <span className="font-medium text-foreground">
                Manifest plugins:
              </span>{" "}
              {runtime.manifest?.plugins.join(", ") || "(loading...)"}
            </div>
            <div>
              <span className="font-medium text-foreground">Runtime:</span>{" "}
              {runtime.isLoading
                ? "syncing"
                : runtime.error
                  ? "degraded"
                  : "healthy"}
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-lg">Resolved Routes</h2>
            <ul className="mt-3 grid gap-2 text-muted-foreground text-sm">
              {resolved.flatMap((module) =>
                module.routes.map((route) => (
                  <li
                    className="rounded-md border border-border bg-muted/30 px-3 py-2"
                    key={`${module.id}:${route.id}`}
                  >
                    <span className="font-medium text-foreground">
                      {route.path}
                    </span>
                    <span className="ml-2">({module.id})</span>
                  </li>
                ))
              )}
            </ul>
          </article>

          <article className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-semibold text-lg">Vocabulary Pack</h2>
            <ul className="mt-3 grid gap-2 text-muted-foreground text-sm">
              {Object.entries(preset.vocabulary).map(([key, value]) => (
                <li
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  key={key}
                >
                  <span className="font-medium text-foreground">{key}</span>
                  <span>{value}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </section>
    </main>
  );
}

export function VerticalApp({ verticalId }: { verticalId: VerticalId }) {
  const preset = useMemo(() => getVerticalPreset(verticalId), [verticalId]);
  useEffect(() => {
    applyThemePack({ themeId: preset.themePack });
  }, [preset.themePack]);

  return (
    <VerticalRuntimeProvider orgId={pickOrgId()}>
      <VerticalShellBody verticalId={verticalId} />
    </VerticalRuntimeProvider>
  );
}
