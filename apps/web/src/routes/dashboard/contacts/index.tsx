// =============================================================================
// RELATIONSHIP DASHBOARD PAGE
// =============================================================================
//
// Intelligence-first view of your network. Not a contacts list - it's a
// relationship health dashboard showing who matters, who needs attention,
// and deep dossiers for meeting prep.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Search, Star, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CustomerContextPanel } from "@/components/contacts/customer-context-panel";
import { ContactCard, type ContactCardData } from "@/components/dashboards";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import { type ContactSummary, contactsAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/contacts/")({
  component: ContactsPage,
});

// =============================================================================
// TYPES
// =============================================================================

type ViewFilter = "all" | "vip" | "at_risk";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function ContactsPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [profileContactId, setProfileContactId] = useState<string | null>(null);

  // Fetch stats
  const {
    data: statsData,
    isLoading: isLoadingStats,
    isError: statsIsError,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["contacts", "stats", organizationId],
    queryFn: () => contactsAPI.getStats(organizationId),
    enabled: !!organizationId,
  });

  // Fetch contacts based on filter
  const {
    data: contactsData,
    isLoading: isLoadingContacts,
    isError: contactsIsError,
    error: contactsError,
    refetch: refetchAllContacts,
  } = useQuery({
    queryKey: ["contacts", "list", organizationId],
    queryFn: () => contactsAPI.list({ organizationId, limit: 50 }),
    enabled: !!organizationId && viewFilter === "all",
  });

  // VIP contacts query
  const {
    data: vipData,
    isLoading: isLoadingVip,
    isError: vipIsError,
    error: vipError,
    refetch: refetchVip,
  } = useQuery({
    queryKey: ["contacts", "vips", organizationId],
    queryFn: () => contactsAPI.getVips({ organizationId, limit: 50 }),
    enabled: !!organizationId && viewFilter === "vip",
  });

  // At-risk contacts query
  const {
    data: atRiskData,
    isLoading: isLoadingAtRisk,
    isError: atRiskIsError,
    error: atRiskError,
    refetch: refetchAtRisk,
  } = useQuery({
    queryKey: ["contacts", "at-risk", organizationId],
    queryFn: () => contactsAPI.getAtRisk({ organizationId, limit: 50 }),
    enabled: !!organizationId && viewFilter === "at_risk",
  });

  // Search query
  const {
    data: searchData,
    isLoading: isLoadingSearch,
    isError: searchIsError,
    error: searchError,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ["contacts", "search", organizationId, searchQuery],
    queryFn: () =>
      contactsAPI.search({ organizationId, query: searchQuery, limit: 20 }),
    enabled: !!organizationId && searchQuery.length > 2,
  });

  const handleRefresh = useCallback(async () => {
    // Always keep stats fresh as well (cheap + used in header).
    refetchStats().catch(() => undefined);

    if (searchQuery.length > 2) {
      await refetchSearch();
      return;
    }
    if (viewFilter === "vip") {
      await refetchVip();
      return;
    }
    if (viewFilter === "at_risk") {
      await refetchAtRisk();
      return;
    }
    await refetchAllContacts();
  }, [
    refetchAllContacts,
    refetchAtRisk,
    refetchSearch,
    refetchStats,
    refetchVip,
    searchQuery,
    viewFilter,
  ]);

  // Mutations
  const toggleVipMutation = useMutation({
    mutationFn: async ({
      contactId,
      isVip,
    }: {
      contactId: string;
      isVip: boolean;
    }) => contactsAPI.toggleVip(contactId, organizationId, isVip),
    onSuccess: () => {
      toast.success(t("pages.dashboard.contacts.toasts.vipUpdated"));
      handleRefresh().catch(() => undefined);
    },
    onError: () => {
      toast.error(t("pages.dashboard.contacts.toasts.vipFailed"));
    },
  });

  const meetingBriefMutation = useMutation({
    mutationFn: async (contactId: string) =>
      contactsAPI.generateMeetingBrief(contactId, organizationId),
    onSuccess: (_data) => {
      toast.success(t("pages.dashboard.contacts.toasts.briefGenerated"), {
        description: t("pages.dashboard.contacts.toasts.briefGeneratedHint"),
      });
    },
    onError: () => {
      toast.error(t("pages.dashboard.contacts.toasts.briefFailed"));
    },
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // vim-style navigation
      const contacts = getCurrentContacts();
      if (e.key === "j") {
        const currentIndex = contacts.findIndex(
          (c) => c.id === selectedContact
        );
        if (currentIndex < contacts.length - 1) {
          setSelectedContact(contacts[currentIndex + 1]?.id ?? null);
        }
      }
      if (e.key === "k") {
        const currentIndex = contacts.findIndex(
          (c) => c.id === selectedContact
        );
        if (currentIndex > 0) {
          setSelectedContact(contacts[currentIndex - 1]?.id ?? null);
        }
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById("contact-search")?.focus();
      }
      if (e.key === "r") {
        handleRefresh().catch(() => undefined);
      }
      if (e.key === "1") {
        setViewFilter("all");
      }
      if (e.key === "2") {
        setViewFilter("vip");
      }
      if (e.key === "3") {
        setViewFilter("at_risk");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedContact, viewFilter, searchQuery, handleRefresh]);

  // Get current contacts based on filter
  const getCurrentContacts = useCallback((): ContactCardData[] => {
    let rawContacts: ContactSummary[] | undefined;

    if (searchQuery.length > 2 && searchData?.items) {
      rawContacts = searchData.items;
    } else if (viewFilter === "vip" && vipData?.items) {
      rawContacts = vipData.items;
    } else if (viewFilter === "at_risk" && atRiskData?.items) {
      rawContacts = atRiskData.items;
    } else {
      rawContacts = contactsData?.items;
    }

    return (rawContacts ?? []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      primaryEmail: c.primaryEmail,
      title: c.title,
      company: c.company,
      phone: null,
      linkedinUrl: null,
      avatarUrl: c.avatarUrl,
      isVip: c.isVip ?? false,
      isAtRisk: c.isAtRisk ?? false,
      importanceScore: c.importanceScore,
      healthScore: c.healthScore,
      engagementScore: c.engagementScore,
      sentimentScore: c.sentimentScore,
      totalThreads: c.totalThreads,
      totalMessages: c.totalMessages,
      firstInteractionAt: null,
      lastInteractionAt: c.lastInteractionAt
        ? new Date(c.lastInteractionAt)
        : null,
      avgResponseTimeHours: null,
      responseRate: null,
      tags: null,
    }));
  }, [contactsData, vipData, atRiskData, searchData, searchQuery, viewFilter]);

  // Handlers
  const handleToggleVip = useCallback(
    (contactId: string) => {
      // Find current VIP status from contacts
      const allContacts = getCurrentContacts();
      const contact = allContacts.find((c) => c.id === contactId);
      const currentVipStatus = contact?.isVip ?? false;
      toggleVipMutation.mutate({ contactId, isVip: !currentVipStatus });
    },
    [toggleVipMutation, getCurrentContacts]
  );

  const handleGenerateMeetingBrief = useCallback(
    (contactId: string) => {
      meetingBriefMutation.mutate(contactId);
    },
    [meetingBriefMutation]
  );

  const handleEmailClick = useCallback((email: string) => {
    window.location.href = `mailto:${email}`;
  }, []);

  const handleViewProfile = useCallback((contactId: string) => {
    setProfileContactId(contactId);
    setShowProfileSheet(true);
  }, []);

  const contacts = getCurrentContacts();

  const isLoading =
    viewFilter === "all"
      ? isLoadingContacts
      : viewFilter === "vip"
        ? isLoadingVip
        : isLoadingAtRisk;

  const activeIsError =
    searchQuery.length > 2
      ? searchIsError
      : viewFilter === "vip"
        ? vipIsError
        : viewFilter === "at_risk"
          ? atRiskIsError
          : contactsIsError;

  const activeError =
    searchQuery.length > 2
      ? searchError
      : viewFilter === "vip"
        ? vipError
        : viewFilter === "at_risk"
          ? atRiskError
          : contactsError;

  const stats = {
    total: statsData?.totalContacts ?? 0,
    vipCount: statsData?.vipCount ?? 0,
    atRiskCount: statsData?.atRiskCount ?? 0,
    recentlyActiveCount: 0,
    needsAttentionCount: 0,
    avgHealthScore: statsData?.avgHealthScore ?? 0,
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          {t("pages.dashboard.contacts.selectOrg")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* View Filter Tabs */}
            <Tabs
              onValueChange={(v) => setViewFilter(v as ViewFilter)}
              value={viewFilter}
            >
              <TabsList className="h-8 gap-1 bg-transparent">
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="all"
                >
                  <Users className="h-4 w-4" />
                  {t("pages.dashboard.contacts.tabs.all")}
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.total}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="vip"
                >
                  <Star className="h-4 w-4" />
                  {t("pages.dashboard.contacts.tabs.vip")}
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.vipCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="at_risk"
                >
                  <AlertTriangle className="h-4 w-4" />
                  {t("pages.dashboard.contacts.tabs.atRisk")}
                  {stats.atRiskCount > 0 && (
                    <Badge
                      className="ml-1 px-1.5 py-0 text-[10px]"
                      variant="destructive"
                    >
                      {stats.atRiskCount}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-[200px] pl-8 text-sm"
                  id="contact-search"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("pages.dashboard.contacts.search.placeholder")}
                  value={searchQuery}
                />
              </div>

              <Button
                className="h-8 w-8"
                onClick={() => handleRefresh().catch(() => undefined)}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* Keyboard hints */}
              <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
                <kbd className="rounded bg-muted px-1.5 py-0.5">/</kbd>
                <span>{t("pages.dashboard.contacts.hints.search")}</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">j/k</kbd>
                <span>{t("pages.dashboard.contacts.hints.nav")}</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">1-3</kbd>
                <span>{t("pages.dashboard.contacts.hints.tabs")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingStats && !statsData ? (
            <div className="p-4">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : statsIsError && !statsData ? (
            <div className="p-4">
              <ApiErrorPanel
                error={statsError}
                onRetry={() => handleRefresh().catch(() => undefined)}
              />
            </div>
          ) : activeIsError ? (
            <div className="p-4">
              <ApiErrorPanel
                error={activeError}
                onRetry={() => handleRefresh().catch(() => undefined)}
              />
            </div>
          ) : isLoading || (searchQuery.length > 2 && isLoadingSearch) ? (
            <div>
              {[...new Array(10)].map((_, i) => (
                <div
                  className="flex items-center gap-4 border-border/40 border-b px-4 py-3"
                  key={i}
                >
                  <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">
                {searchQuery.length > 2
                  ? t("pages.dashboard.contacts.empty.search")
                  : viewFilter === "vip"
                    ? t("pages.dashboard.contacts.empty.vip")
                    : viewFilter === "at_risk"
                      ? t("pages.dashboard.contacts.empty.atRisk")
                      : t("pages.dashboard.contacts.empty.all")}
              </h3>
              <p className="mt-1 text-muted-foreground text-sm">
                {t("pages.dashboard.contacts.empty.description")}
              </p>
            </div>
          ) : (
            <div>
              {contacts.map((contact) => (
                <ContactCard
                  contact={contact}
                  isSelected={selectedContact === contact.id}
                  key={contact.id}
                  onEmailClick={handleEmailClick}
                  onGenerateMeetingBrief={handleGenerateMeetingBrief}
                  onSelect={() => setSelectedContact(contact.id)}
                  onToggleVip={handleToggleVip}
                  onViewProfile={handleViewProfile}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Contact Profile Sheet - Now with rich Customer Context */}
      <Sheet onOpenChange={setShowProfileSheet} open={showProfileSheet}>
        <SheetContent className="w-[540px] overflow-y-auto">
          {profileContactId && (
            <CustomerContextPanel
              contactId={profileContactId}
              organizationId={organizationId}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
