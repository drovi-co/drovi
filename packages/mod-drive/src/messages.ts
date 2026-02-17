import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_DRIVE_NAMESPACE = "mod_drive";

export const modDriveMessages: Record<string, string> = {
  "drive.title": "Archive",
  "drive.upload": "Deposit document",
  "drive.search": "Search archive",
  "drive.status": "Archive ingestion status",
};

export const modDriveI18n: ModuleI18nNamespace = {
  namespace: MOD_DRIVE_NAMESPACE,
  defaultLocale: "en",
  messages: modDriveMessages,
};
