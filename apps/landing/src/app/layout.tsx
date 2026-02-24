import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import { QueryProvider } from "@/providers/query-provider";

import "./global.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Drovi - The Live Institutional Ledger",
  description:
    "Drovi is a live institutional ledger. It watches the world and your organization continuously, computes exposure, updates belief states with evidence, and proposes governed interventions.",
  keywords: [
    "institutional ledger",
    "world model",
    "exposure monitoring",
    "belief graph",
    "governed intervention",
    "organizational cognition",
  ],
  authors: [{ name: "Drovi" }],
  openGraph: {
    title: "Drovi - The Live Institutional Ledger",
    description:
      "A live institutional ledger for high-consequence teams. Evidence-backed beliefs, exposure maps, and governed interventions.",
    type: "website",
    locale: "en_US",
    siteName: "Drovi",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drovi - The Live Institutional Ledger",
    description:
      "Drovi computes exposure as reality shifts, updates what is true with evidence, and helps institutions act before loss, liability, or surprise.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f0906",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={inter.variable} lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
          enableSystem={false}
          forcedTheme="dark"
        >
          <QueryProvider>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                style: {
                  background: "var(--card)",
                  color: "var(--card-foreground)",
                  border: "1px solid var(--border)",
                },
              }}
            />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
