import { createAuthModule } from "@memorystack/mod-auth";
import { createConsoleModule } from "@memorystack/mod-console";
import { resolveModules } from "@memorystack/mod-kit";

const adminModules = resolveModules({
  modules: [
    createAuthModule({
      policy: {
        postLoginRedirect: "/dashboard",
      },
    }),
    createConsoleModule(),
  ],
  enabledCapabilities: {
    "ops.internal": true,
  },
});

export function getAdminModules() {
  return adminModules;
}

export function getAdminModule(moduleId: string) {
  return adminModules.find((module) => module.id === moduleId) ?? null;
}

export function getAdminPostLoginRedirect(): string {
  const authModule = getAdminModule("mod-auth");
  const value = authModule?.uiHints.postLoginRedirect;
  return typeof value === "string" && value.length > 0 ? value : "/dashboard";
}
