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
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  RefreshCw,
  Search,
  Star,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  ContactCard,
  ContactStats,
  type ContactCardData,
} from "@/components/dashboards";
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
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
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
  const { data: contactsData, isLoading: isLoadingContacts, refetch } = useQuery({
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

  // Contact profile query
  const { data: profileData, isLoading: isLoadingProfile } = useQuery({
    ...trpc.contacts.get.queryOptions({
      organizationId,
      contactId: profileContactId ?? "",
    }),
    enabled: !!organizationId && !!profileContactId,
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
    onSuccess: (data) => {
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
        const currentIndex = contacts.findIndex((c) => c.id === selectedContact);
        if (currentIndex < contacts.length - 1) {
          setSelectedContact(contacts[currentIndex + 1]?.id ?? null);
        }
      }
      if (e.key === "k") {
        const currentIndex = contacts.findIndex((c) => c.id === selectedContact);
        if (currentIndex > 0) {
          setSelectedContact(contacts[currentIndex - 1]?.id ?? null);
        }
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById("contact-search")?.focus();
      }
      if (e.key === "r") refetch();
      if (e.key === "1") setViewFilter("all");
      if (e.key === "2") setViewFilter("vip");
      if (e.key === "3") setViewFilter("at_risk");
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
      firstInteractionAt: c.firstInteractionAt ? new Date(c.firstInteractionAt) : null,
      lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt) : null,
      avgResponseTimeHours: c.avgResponseTimeMinutes ? c.avgResponseTimeMinutes / 60 : null,
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

  const handleEmailClick = useCallback(
    (email: string) => {
      window.location.href = `mailto:${email}`;
    },
    []
  );

  const handleViewProfile = useCallback(
    (contactId: string) => {
      setProfileContactId(contactId);
      setShowProfileSheet(true);
    },
    []
  );

  const contacts = getCurrentContacts();
  const isLoading = viewFilter === "all" ? isLoadingContacts :
    viewFilter === "vip" ? isLoadingVip :
    isLoadingAtRisk;

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
      <div className="h-full flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select an organization to view contacts</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Relationship Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Intelligence-first view of your network
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Stats */}
          {isLoadingStats ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <ContactStats stats={stats} />
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="container flex items-center gap-4">
          {/* View Filter Tabs */}
          <Tabs value={viewFilter} onValueChange={(v) => setViewFilter(v as ViewFilter)}>
            <TabsList>
              <TabsTrigger value="all">
                <Users className="h-4 w-4 mr-2" />
                All
                <Badge variant="secondary" className="ml-2 text-xs">
                  {stats.total}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="vip">
                <Star className="h-4 w-4 mr-2" />
                VIPs
                <Badge variant="secondary" className="ml-2 text-xs">
                  {stats.vipCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="at_risk">
                <AlertTriangle className="h-4 w-4 mr-2" />
                At Risk
                {stats.atRiskCount > 0 && (
                  <Badge variant="destructive" className="ml-2 text-xs">
                    {stats.atRiskCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Search */}
          <div className="flex-1 max-w-xs">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="contact-search"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Keyboard hints */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 rounded bg-muted">/</kbd>
            <span>search</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">j/k</kbd>
            <span>navigate</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">1-3</kbd>
            <span>tabs</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="container py-6">
            {isLoading || (searchQuery.length > 2 && isLoadingSearch) ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {contacts.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="col-span-full text-center py-12"
                    >
                      <p className="text-muted-foreground">
                        {searchQuery.length > 2
                          ? "No contacts match your search"
                          : viewFilter === "vip"
                            ? "No VIP contacts yet"
                            : viewFilter === "at_risk"
                              ? "No at-risk relationships"
                              : "No contacts found"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Contacts are automatically extracted from your emails
                      </p>
                    </motion.div>
                  ) : (
                    contacts.map((contact) => (
                      <ContactCard
                        key={contact.id}
                        contact={contact}
                        isSelected={selectedContact === contact.id}
                        onSelect={() => setSelectedContact(contact.id)}
                        onToggleVip={handleToggleVip}
                        onEmailClick={handleEmailClick}
                        onViewProfile={handleViewProfile}
                        onGenerateMeetingBrief={handleGenerateMeetingBrief}
                      />
                    ))
                  )}
                </div>
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Contact Profile Sheet */}
      <Sheet open={showProfileSheet} onOpenChange={setShowProfileSheet}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>Contact Profile</SheetTitle>
            <SheetDescription>
              Detailed relationship intelligence
            </SheetDescription>
          </SheetHeader>
          <div className="py-6">
            {isLoadingProfile ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-20 rounded-full" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-32" />
              </div>
            ) : profileData?.contact ? (
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                    {profileData.contact.displayName?.[0] ?? profileData.contact.primaryEmail[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">
                      {profileData.contact.displayName ?? profileData.contact.primaryEmail}
                    </h3>
                    {profileData.contact.title && (
                      <p className="text-sm text-muted-foreground">
                        {profileData.contact.title}
                        {profileData.contact.company && ` at ${profileData.contact.company}`}
                      </p>
                    )}
                    <p className="text-sm text-primary">{profileData.contact.primaryEmail}</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{profileData.contact.totalThreads ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Threads</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{profileData.contact.totalMessages ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Messages</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    onClick={() => handleGenerateMeetingBrief(profileData.contact.id)}
                    disabled={meetingBriefMutation.isPending}
                  >
                    Generate Meeting Brief
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleEmailClick(profileData.contact.primaryEmail)}
                  >
                    Send Email
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground">Contact not found</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
