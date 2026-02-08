import { create } from "zustand";

export interface SupportTicketPrefill {
  subject?: string;
  message?: string;
  route?: string;
  locale?: string;
  diagnostics?: Record<string, unknown>;
}

interface SupportModalState {
  open: boolean;
  prefill: SupportTicketPrefill | null;
  openWith: (prefill?: SupportTicketPrefill) => void;
  close: () => void;
}

export const useSupportModalStore = create<SupportModalState>((set) => ({
  open: false,
  prefill: null,
  openWith: (prefill) => set({ open: true, prefill: prefill ?? null }),
  close: () => set({ open: false, prefill: null }),
}));

