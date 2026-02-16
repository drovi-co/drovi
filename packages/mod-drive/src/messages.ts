import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_DRIVE_NAMESPACE = "mod_drive";

export const modDriveMessages: Record<string, string> = {
  "drive.title": "Drive",
  "drive.upload": "Upload document",
  "drive.search": "Search documents",
  "drive.status": "Ingestion status",
};

export const modDriveI18n: ModuleI18nNamespace = {
  namespace: MOD_DRIVE_NAMESPACE,
  defaultLocale: "en",
  messages: modDriveMessages,
};
