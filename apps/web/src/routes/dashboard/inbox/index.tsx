// =============================================================================
// SMART INBOX - Conversation-Centric Intelligence Dashboard
// =============================================================================
//
// Conversation-first design showing:
// - Left panel (1/3): Conversation list with intelligence indicators
// - Right panel (2/3): Selected conversation with messages and linked UIOs
//
// UIOs (commitments, decisions, tasks) are shown as linked cards within
// conversation details, with navigation to their respective detail pages.

"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { useCommandBar } from "@/components/email/command-bar";
import {
  ConversationListPanel,
  type ConversationFilters,
  type ConversationTab,
} from "@/components/smart-inbox/conversation-list-panel";
import { ConversationDetailPanel } from "@/components/smart-inbox/conversation-detail-panel";
import type { SourceType } from "@/lib/source-config";
import { useActiveOrganization } from "@/lib/auth-client";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

const inboxSearchSchema = z.object({
  // Tab filter: all, unread, starred, done
  tab: z.enum(["all", "unread", "starred", "done"]).optional().catch("all"),
  // Source filter: comma-separated source types
  sources: z.string().optional(),
  // Selected conversation ID
  id: z.string().optional(),
  // Search query
  q: z.string().optional(),
});

export const Route = createFileRoute("/dashboard/inbox/")({
  component: SmartInboxPage,
  validateSearch: inboxSearchSchema,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SmartInboxPage() {
  const navigate = useNavigate();
  const { openCompose } = useCommandBar();
  const { data: activeOrg } = useActiveOrganization();

  // Get search params from URL
  const search = Route.useSearch();
  const activeTab = (search.tab ?? "all") as ConversationTab;
  const selectedConversationId = search.id ?? null;
  const searchQuery = search.q;

  // Parse source types from comma-separated string
  const sourceTypes = useMemo((): SourceType[] | undefined => {
    if (!search.sources) return undefined;
    return search.sources.split(",").filter(Boolean) as SourceType[];
  }, [search.sources]);

  // Build filters object
  const filters = useMemo((): ConversationFilters => ({
    tab: activeTab,
    sourceTypes,
    search: searchQuery,
  }), [activeTab, sourceTypes, searchQuery]);

  // Handle conversation selection - update URL
  const handleSelectConversation = useCallback((id: string) => {
    navigate({
      to: "/dashboard/inbox",
      search: (prev) => ({ ...prev, id }),
    });
  }, [navigate]);

  // Handle closing detail panel - remove ID from URL
  const handleCloseDetail = useCallback(() => {
    navigate({
      to: "/dashboard/inbox",
      search: (prev) => {
        const { id, ...rest } = prev;
        return rest;
      },
    });
  }, [navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.closest("[role='dialog']")
      ) {
        return;
      }

      // C to compose (when not in input)
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openCompose();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCompose]);

  // Organization ID
  const organizationId = activeOrg?.id ?? "";

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading organization...</p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))]">
        {/* Left panel - Conversation List (1/3) */}
        <ConversationListPanel
          className="w-1/3 min-w-[320px] max-w-[400px]"
          filters={filters}
          onSelect={handleSelectConversation}
          selectedId={selectedConversationId}
        />

        {/* Right panel - Conversation Detail (2/3) */}
        <div className="flex-1 bg-background">
          <ConversationDetailPanel
            className="h-full"
            conversationId={selectedConversationId}
            onClose={handleCloseDetail}
          />
        </div>
      </div>
    </div>
  );
}
