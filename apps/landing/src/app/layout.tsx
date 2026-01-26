import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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
  title: "Drovi - The Memory Layer for Work",
  description:
    "Drovi remembers what your company decided, promised, and still owes — everywhere it was said. A living system of record for decisions, commitments, and relationships across internal teams and customer conversations.",
  keywords: [
    "work memory",
    "organizational memory",
    "decision tracking",
    "commitment tracking",
    "productivity",
    "knowledge management",
  ],
  authors: [{ name: "Drovi" }],
  openGraph: {
    title: "Drovi - The Memory Layer for Work",
    description:
      "Drovi remembers what your company decided, promised, and still owes — across internal teams and customer conversations.",
    type: "website",
    locale: "en_US",
    siteName: "Drovi",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drovi - The Memory Layer for Work",
    description:
      "Drovi remembers what your company decided, promised, and still owes — across internal teams and customer conversations.",
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
      </body>
    </html>
  );
}
