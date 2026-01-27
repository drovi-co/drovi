// =============================================================================
// CONTACT PROFILE PAGE
// =============================================================================
//
// Full-page contact detail view with comprehensive intelligence including:
// - Contact profile header with key metrics
// - Intelligence dashboard with scores and trends
// - Relationship timeline across all sources
// - Open commitments and decisions
// - Alerts and risk indicators
//

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Edit,
  ExternalLink,
  FileText,
  Linkedin,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Phone,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { CommentThread, WhoIsViewing } from "@/components/collaboration";
import { ContactIntelligenceDashboard } from "@/components/contacts/contact-intelligence-dashboard";
import { RelationshipTimeline } from "@/components/contacts/relationship-timeline";
import { AlertsManagement } from "@/components/contacts/alerts-management";
import { useTrackViewing } from "@/hooks/use-presence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/contacts/$contactId")({
  component: ContactProfilePage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function ContactProfilePage() {
  const navigate = useNavigate();
  const { contactId } = useParams({ from: "/dashboard/contacts/$contactId" });
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const organizationId = activeOrg?.id ?? "";
  const currentUserId = session?.user?.id ?? "";

  // Track viewing for presence
  useTrackViewing({
    organizationId,
    resourceType: "contact",
    resourceId: contactId,
    enabled: Boolean(organizationId && contactId),
  });

  // State
  const [activeTab, setActiveTab] = useState<string>("intelligence");
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: "",
    title: "",
    company: "",
    phone: "",
    linkedinUrl: "",
    notes: "",
  });

  // Fetch contact details
  const {
    data: contactData,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.contacts.get.queryOptions({
      organizationId,
      contactId,
    }),
    enabled: !!organizationId && !!contactId,
  });

  const contact = contactData?.contact;
  const recentThreads = contactData?.recentThreads ?? [];

  // Toggle VIP mutation
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

  // Update contact mutation
  const updateContactMutation = useMutation({
    ...trpc.contacts.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Contact updated");
      setShowEditSheet(false);
      refetch();
    },
    onError: () => {
      toast.error("Failed to update contact");
    },
  });

  // Generate meeting brief mutation
  const meetingBriefMutation = useMutation({
    ...trpc.contacts.generateMeetingBrief.mutationOptions(),
    onSuccess: () => {
      toast.success("Meeting brief generated");
    },
    onError: () => {
      toast.error("Failed to generate meeting brief");
    },
  });

  // Handlers
  const handleBack = useCallback(() => {
    navigate({ to: "/dashboard/contacts" });
  }, [navigate]);

  const handleToggleVip = useCallback(() => {
    if (!organizationId || !contactId) return;
    toggleVipMutation.mutate({ organizationId, contactId });
  }, [toggleVipMutation, organizationId, contactId]);

  const handleEdit = useCallback(() => {
    if (!contact) return;
    setEditForm({
      displayName: contact.displayName ?? "",
      title: contact.title ?? "",
      company: contact.company ?? "",
      phone: contact.phone ?? "",
      linkedinUrl: contact.linkedinUrl ?? "",
      notes: contact.notes ?? "",
    });
    setShowEditSheet(true);
  }, [contact]);

  const handleSaveEdit = useCallback(() => {
    if (!organizationId || !contactId) return;
    updateContactMutation.mutate({
      organizationId,
      contactId,
      ...editForm,
    });
  }, [updateContactMutation, organizationId, contactId, editForm]);

  const handleGenerateBrief = useCallback(() => {
    if (!organizationId || !contactId) return;
    meetingBriefMutation.mutate({ organizationId, contactId });
  }, [meetingBriefMutation, organizationId, contactId]);

  const handleEmailClick = useCallback(() => {
    if (!contact?.primaryEmail) return;
    window.location.href = `mailto:${contact.primaryEmail}`;
  }, [contact]);

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full" data-no-shell-padding>
        <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
          <ContactProfileSkeleton />
        </div>
      </div>
    );
  }

  // Not found state
  if (!contact) {
    return (
      <div className="h-full" data-no-shell-padding>
        <div className="flex h-[calc(100vh-var(--header-height))] flex-col items-center justify-center">
          <User className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="font-semibold text-lg">Contact Not Found</h2>
          <p className="text-muted-foreground text-sm">
            The contact you're looking for doesn't exist.
          </p>
          <Button className="mt-4" onClick={handleBack} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Contacts
          </Button>
        </div>
      </div>
    );
  }

  // Get initials for avatar
  const initials =
    contact.displayName
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? contact.primaryEmail[0]?.toUpperCase() ?? "?";

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center gap-4 px-6 py-4">
            {/* Back button */}
            <Button
              className="h-8 w-8"
              onClick={handleBack}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            {/* Avatar */}
            <Avatar className="h-14 w-14">
              <AvatarImage src={contact.avatarUrl ?? undefined} />
              <AvatarFallback className="bg-primary/10 font-medium text-lg text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>

            {/* Contact info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-xl truncate">
                  {contact.displayName ?? contact.primaryEmail}
                </h1>
                {contact.isVip && (
                  <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">
                    <Star className="mr-1 h-3 w-3 fill-current" />
                    VIP
                  </Badge>
                )}
                {contact.isAtRisk && (
                  <Badge variant="destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    At Risk
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex items-center gap-4 text-muted-foreground text-sm">
                {contact.title && (
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" />
                    {contact.title}
                  </span>
                )}
                {contact.company && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {contact.company}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {contact.primaryEmail}
                </span>
              </div>
            </div>

            {/* Quick metrics */}
            <div className="hidden lg:flex items-center gap-6">
              <MetricBadge
                label="Health"
                value={contact.healthScore}
                type="health"
              />
              <MetricBadge
                label="Engagement"
                value={contact.engagementScore}
                type="engagement"
              />
              <MetricBadge
                label="Importance"
                value={contact.importanceScore}
                type="importance"
              />
            </div>

            {/* Who is viewing */}
            <WhoIsViewing
              organizationId={organizationId}
              resourceType="contact"
              resourceId={contactId}
              compact
            />

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button onClick={handleEmailClick} size="sm" variant="outline">
                <Mail className="mr-2 h-4 w-4" />
                Email
              </Button>
              <Button
                onClick={handleGenerateBrief}
                disabled={meetingBriefMutation.isPending}
                size="sm"
                variant="outline"
              >
                {meetingBriefMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Meeting Brief
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleEdit}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Contact
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleToggleVip}>
                    <Star className="mr-2 h-4 w-4" />
                    {contact.isVip ? "Remove VIP" : "Mark as VIP"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {contact.linkedinUrl && (
                    <DropdownMenuItem asChild>
                      <a
                        href={contact.linkedinUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <Linkedin className="mr-2 h-4 w-4" />
                        View LinkedIn
                        <ExternalLink className="ml-auto h-3 w-3" />
                      </a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh Data
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          <Tabs
            className="h-full"
            onValueChange={setActiveTab}
            value={activeTab}
          >
            <div className="border-b px-6">
              <TabsList className="h-10 gap-1 bg-transparent">
                <TabsTrigger
                  className="px-4 data-[state=active]:bg-accent"
                  value="intelligence"
                >
                  Intelligence
                </TabsTrigger>
                <TabsTrigger
                  className="px-4 data-[state=active]:bg-accent"
                  value="timeline"
                >
                  Timeline
                </TabsTrigger>
                <TabsTrigger
                  className="px-4 data-[state=active]:bg-accent"
                  value="alerts"
                >
                  Alerts
                </TabsTrigger>
                <TabsTrigger
                  className="px-4 data-[state=active]:bg-accent"
                  value="threads"
                >
                  Conversations
                  {recentThreads.length > 0 && (
                    <Badge className="ml-2" variant="secondary">
                      {recentThreads.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="px-4 data-[state=active]:bg-accent"
                  value="discussion"
                >
                  <MessageSquare className="mr-1.5 h-4 w-4" />
                  Discussion
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent className="m-0 h-[calc(100%-2.5rem)]" value="intelligence">
              <div className="p-6">
                <ContactIntelligenceDashboard
                  contactId={contactId}
                  organizationId={organizationId}
                  onRefresh={refetch}
                />
              </div>
            </TabsContent>

            <TabsContent className="m-0 h-[calc(100%-2.5rem)]" value="timeline">
              <div className="p-6">
                <RelationshipTimeline
                  contactId={contactId}
                  organizationId={organizationId}
                />
              </div>
            </TabsContent>

            <TabsContent className="m-0 h-[calc(100%-2.5rem)] overflow-auto" value="alerts">
              <div className="p-6">
                <AlertsManagement
                  organizationId={organizationId}
                  contactId={contactId}
                />
              </div>
            </TabsContent>

            <TabsContent className="m-0 h-[calc(100%-2.5rem)] overflow-auto" value="threads">
              <div className="p-6">
                {recentThreads.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <Mail className="mb-4 h-12 w-12 text-muted-foreground" />
                      <h3 className="font-medium">No Recent Conversations</h3>
                      <p className="text-muted-foreground text-sm">
                        No email threads with this contact in the last 90 days.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recent Conversations</CardTitle>
                      <CardDescription>
                        Email threads with {contact.displayName ?? "this contact"} in the last 90 days
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {recentThreads.map((thread) => (
                          <div
                            className="flex items-center gap-4 px-6 py-3 hover:bg-muted/50 cursor-pointer"
                            key={thread.id}
                            onClick={() =>
                              navigate({
                                to: "/dashboard/email/thread/$threadId",
                                params: { threadId: thread.id },
                              })
                            }
                          >
                            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">
                                {thread.subject ?? "No Subject"}
                              </p>
                              {thread.snippet && (
                                <p className="text-muted-foreground text-xs truncate">
                                  {thread.snippet}
                                </p>
                              )}
                            </div>
                            <span className="text-muted-foreground text-xs whitespace-nowrap">
                              {thread.lastMessageAt
                                ? formatDistanceToNow(new Date(thread.lastMessageAt), {
                                    addSuffix: true,
                                  })
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent className="m-0 h-[calc(100%-2.5rem)] overflow-auto" value="discussion">
              <div className="p-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Team Discussion</CardTitle>
                    <CardDescription>
                      Internal notes and discussion about {contact.displayName ?? "this contact"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {organizationId && currentUserId && (
                      <CommentThread
                        organizationId={organizationId}
                        targetType="contact"
                        targetId={contactId}
                        currentUserId={currentUserId}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Edit Sheet */}
      <Sheet onOpenChange={setShowEditSheet} open={showEditSheet}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Contact</SheetTitle>
            <SheetDescription>
              Update contact information and notes.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Name</Label>
              <Input
                id="displayName"
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, displayName: e.target.value }))
                }
                value={editForm.displayName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g., VP of Sales"
                value={editForm.title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, company: e.target.value }))
                }
                value={editForm.company}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, phone: e.target.value }))
                }
                type="tel"
                value={editForm.phone}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
              <Input
                id="linkedinUrl"
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, linkedinUrl: e.target.value }))
                }
                placeholder="https://linkedin.com/in/..."
                type="url"
                value={editForm.linkedinUrl}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Add personal notes about this contact..."
                rows={4}
                value={editForm.notes}
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                onClick={() => setShowEditSheet(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={updateContactMutation.isPending}
                onClick={handleSaveEdit}
              >
                {updateContactMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// =============================================================================
// METRIC BADGE COMPONENT
// =============================================================================

interface MetricBadgeProps {
  label: string;
  value: number | null | undefined;
  type: "health" | "engagement" | "importance";
}

function MetricBadge({ label, value, type }: MetricBadgeProps) {
  const normalizedValue = value !== null && value !== undefined ? Math.round(value * 100) : null;

  const getColor = () => {
    if (normalizedValue === null) return "text-muted-foreground";
    if (normalizedValue >= 70) return "text-green-600";
    if (normalizedValue >= 40) return "text-amber-600";
    return "text-red-600";
  };

  const getIcon = () => {
    if (normalizedValue === null) return null;
    if (normalizedValue >= 70) return <TrendingUp className="h-3 w-3" />;
    if (normalizedValue < 40) return <TrendingDown className="h-3 w-3" />;
    return null;
  };

  return (
    <div className="text-center">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className={cn("flex items-center justify-center gap-1 font-semibold", getColor())}>
        {normalizedValue !== null ? `${normalizedValue}%` : "N/A"}
        {getIcon()}
      </div>
    </div>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function ContactProfileSkeleton() {
  return (
    <>
      <div className="border-b bg-background">
        <div className="flex items-center gap-4 px-6 py-4">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="flex-1 p-6">
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton className="h-32" key={i} />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    </>
  );
}
