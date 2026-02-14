import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./global.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Drovi Intelligence - Documentation",
    template: "%s | Drovi Intelligence",
  },
  description:
    "The memory infrastructure for work. A shared, queryable intelligence layer that humans, agents, and systems rely on to know what's true.",
  keywords: [
    "memory infrastructure",
    "intelligence extraction",
    "knowledge graph",
    "AI agents",
    "commitment tracking",
    "decision tracking",
    "organizational memory",
    "API documentation",
  ],
  authors: [{ name: "Drovi" }],
  openGraph: {
    title: "Drovi Intelligence - Documentation",
    description:
      "The memory infrastructure for work. Extract decisions, commitments, and relationships from every source.",
    type: "website",
    locale: "en_US",
    siteName: "Drovi Intelligence",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drovi Intelligence - Documentation",
    description:
      "The memory infrastructure for work. Extract decisions, commitments, and relationships from every source.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f0906",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html className={inter.variable} lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col antialiased">
        <RootProvider
          theme={{
            enabled: true,
            defaultTheme: "dark",
            forcedTheme: "dark",
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
