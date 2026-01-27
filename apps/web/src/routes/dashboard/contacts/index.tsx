// =============================================================================
// RELATIONSHIP DASHBOARD PAGE
// =============================================================================
//
// Intelligence-first view of your network. Not a contacts list - it's a
// relationship health dashboard showing who matters, who needs attention,
// and deep dossiers for meeting prep.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw, Search, Star, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CustomerContextPanel } from "@/components/contacts/customer-context-panel";
import { ContactCard, type ContactCardData } from "@/components/dashboards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

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
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  const [profileContactId, setProfileContactId] = useState<string | null>(null);

  // Fetch stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    ...trpc.contacts.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Fetch contacts based on filter
  const {
    data: contactsData,
    isLoading: isLoadingContacts,
    refetch,
  } = useQuery({
    ...trpc.contacts.list.queryOptions({
      organizationId,
      limit: 50,
      isVip: viewFilter === "vip" ? true : undefined,
      isAtRisk: viewFilter === "at_risk" ? true : undefined,
    }),
    enabled: !!organizationId && viewFilter === "all",
  });

  // VIP contacts query
  const { data: vipData, isLoading: isLoadingVip } = useQuery({
    ...trpc.contacts.getVips.queryOptions({
      organizationId,
      limit: 50,
    }),
    enabled: !!organizationId && viewFilter === "vip",
  });

  // At-risk contacts query
  const { data: atRiskData, isLoading: isLoadingAtRisk } = useQuery({
    ...trpc.contacts.getAtRisk.queryOptions({
      organizationId,
      limit: 50,
    }),
    enabled: !!organizationId && viewFilter === "at_risk",
  });

  // Search query
  const { data: searchData, isLoading: isLoadingSearch } = useQuery({
    ...trpc.contacts.search.queryOptions({
      organizationId,
      query: searchQuery,
      limit: 20,
    }),
    enabled: !!organizationId && searchQuery.length > 2,
  });

  // Mutations
  const toggleVipMutation = useMutation({
    ...trpc.contacts.toggleVip.mutationOptions(),
    onSuccess: () => {
      toast.success("VIP status updated");
      refetch();
    },
    onError: () => {
      toast.error("Failed to update VIP status");
    },
  });

  const meetingBriefMutation = useMutation({
    ...trpc.contacts.generateMeetingBrief.mutationOptions(),
    onSuccess: (_data) => {
      toast.success("Meeting brief generated", {
        description: "Check your downloads",
      });
    },
    onError: () => {
      toast.error("Failed to generate meeting brief");
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
        refetch();
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
  }, [selectedContact, refetch, viewFilter]);

  // Get current contacts based on filter
  const getCurrentContacts = useCallback((): ContactCardData[] => {
    type RawContact = NonNullable<typeof contactsData>["contacts"][number];
    let rawContacts: RawContact[] | undefined;

    if (searchQuery.length > 2 && searchData?.contacts) {
      rawContacts = searchData.contacts;
    } else if (viewFilter === "vip" && vipData?.contacts) {
      rawContacts = vipData.contacts;
    } else if (viewFilter === "at_risk" && atRiskData?.contacts) {
      rawContacts = atRiskData.contacts;
    } else {
      rawContacts = contactsData?.contacts;
    }

    return (rawContacts ?? []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      primaryEmail: c.primaryEmail,
      title: c.title,
      company: c.company,
      phone: c.phone,
      linkedinUrl: c.linkedinUrl,
      avatarUrl: c.avatarUrl,
      isVip: c.isVip ?? false,
      isAtRisk: c.isAtRisk ?? false,
      importanceScore: c.importanceScore,
      healthScore: c.healthScore,
      engagementScore: c.engagementScore,
      sentimentScore: c.sentimentScore,
      totalThreads: c.totalThreads,
      totalMessages: c.totalMessages,
      firstInteractionAt: c.firstInteractionAt
        ? new Date(c.firstInteractionAt)
        : null,
      lastInteractionAt: c.lastInteractionAt
        ? new Date(c.lastInteractionAt)
        : null,
      avgResponseTimeHours: c.avgResponseTimeMinutes
        ? c.avgResponseTimeMinutes / 60
        : null,
      responseRate: c.responseRate,
      tags: c.tags as string[] | null,
    }));
  }, [contactsData, vipData, atRiskData, searchData, searchQuery, viewFilter]);

  // Handlers
  const handleToggleVip = useCallback(
    (contactId: string) => {
      toggleVipMutation.mutate({ organizationId, contactId });
    },
    [toggleVipMutation, organizationId]
  );

  const handleGenerateMeetingBrief = useCallback(
    (contactId: string) => {
      meetingBriefMutation.mutate({ organizationId, contactId });
    },
    [meetingBriefMutation, organizationId]
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

  const stats = statsData ?? {
    total: 0,
    vipCount: 0,
    atRiskCount: 0,
    recentlyActiveCount: 0,
    needsAttentionCount: 0,
    avgHealthScore: 0,
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
          Select an organization to view contacts
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
                  All
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
                  VIPs
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
                  At Risk
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
                  placeholder="Search contacts..."
                  value={searchQuery}
                />
              </div>

              <Button
                className="h-8 w-8"
                onClick={() => refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* Keyboard hints */}
              <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
                <kbd className="rounded bg-muted px-1.5 py-0.5">/</kbd>
                <span>search</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">j/k</kbd>
                <span>nav</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">1-3</kbd>
                <span>tabs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {isLoading || (searchQuery.length > 2 && isLoadingSearch) ? (
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
                  ? "No contacts match your search"
                  : viewFilter === "vip"
                    ? "No VIP contacts yet"
                    : viewFilter === "at_risk"
                      ? "No at-risk relationships"
                      : "No contacts found"}
              </h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Contacts are automatically extracted from your emails
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
