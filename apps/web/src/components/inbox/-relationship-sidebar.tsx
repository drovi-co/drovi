// =============================================================================
// RELATIONSHIP INTELLIGENCE SIDEBAR
// =============================================================================
//
// Shows inline context about who you're emailing when reading a thread.
// Displays relationship health, open commitments, communication patterns,
// mutual connections, and recent decisions.
//

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, isPast, isToday } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitBranch,
  Mail,
  MessageSquare,
  Star,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface RelationshipSidebarProps {
  contactId: string;
  organizationId: string;
  onClose: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function RelationshipSidebar({
  contactId,
  organizationId,
  onClose,
}: RelationshipSidebarProps) {
  const { data: intel, isLoading } = useQuery({
    ...trpc.contacts.getIntelligence.queryOptions({
      organizationId,
      contactId,
    }),
    enabled: !!contactId && !!organizationId,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <SidebarSkeleton onClose={onClose} />;
  }

  if (!intel) {
    return (
      <div className="flex w-80 flex-col border-l bg-background">
        <SidebarHeader onClose={onClose} />
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-muted-foreground text-sm">Contact not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-80 flex-col border-l bg-background">
      <SidebarHeader onClose={onClose} />

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Contact Header */}
          <ContactHeader contact={intel.contact} />

          {/* Relationship Health */}
          <RelationshipHealthMeter
            healthInsight={intel.healthInsight}
            score={intel.healthScore}
          />

          {/* Communication Pattern */}
          <CommunicationPattern
            metrics={intel.metrics}
            pattern={intel.communicationPattern}
          />

          {/* Open Commitments */}
          {intel.openCommitments.length > 0 && (
            <CommitmentsSection commitments={intel.openCommitments} />
          )}

          {/* Recent Decisions */}
          {intel.recentDecisions.length > 0 && (
            <DecisionsSection decisions={intel.recentDecisions} />
          )}

          {/* Mutual Connections */}
          {intel.mutualContacts.length > 0 && (
            <MutualConnectionsSection contacts={intel.mutualContacts} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function SidebarHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">Relationship Intel</span>
      </div>
      <Button className="h-7 w-7" onClick={onClose} size="icon" variant="ghost">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ContactHeader({
  contact,
}: {
  contact: {
    id: string;
    displayName: string | null;
    primaryEmail: string;
    company: string | null;
    title: string | null;
    avatarUrl: string | null;
    isVip: boolean | null;
    isAtRisk: boolean | null;
  };
}) {
  const initials = contact.displayName
    ? contact.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : contact.primaryEmail.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-12 w-12">
        <AvatarImage src={contact.avatarUrl ?? undefined} />
        <AvatarFallback className="text-sm">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">
            {contact.displayName ?? contact.primaryEmail}
          </h3>
          {contact.isVip && (
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          )}
          {contact.isAtRisk && (
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          )}
        </div>
        {contact.title && (
          <p className="truncate text-muted-foreground text-xs">
            {contact.title}
          </p>
        )}
        {contact.company && (
          <p className="truncate text-muted-foreground text-xs">
            {contact.company}
          </p>
        )}
        <p className="truncate text-muted-foreground text-xs">
          {contact.primaryEmail}
        </p>
      </div>
    </div>
  );
}

function RelationshipHealthMeter({
  score,
  healthInsight,
}: {
  score: number;
  healthInsight: string;
}) {
  const percentage = Math.round(score * 100);
  const getHealthColor = (s: number) => {
    if (s >= 0.7) {
      return "bg-green-500";
    }
    if (s >= 0.4) {
      return "bg-yellow-500";
    }
    return "bg-red-500";
  };

  const getHealthLabel = (s: number) => {
    if (s >= 0.8) {
      return "Excellent";
    }
    if (s >= 0.6) {
      return "Good";
    }
    if (s >= 0.4) {
      return "Fair";
    }
    return "Needs Attention";
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-muted-foreground text-xs">
          Relationship Health
        </span>
        <Badge
          className={cn(
            "text-[10px]",
            score >= 0.7
              ? "bg-green-500/10 text-green-600"
              : score >= 0.4
                ? "bg-yellow-500/10 text-yellow-600"
                : "bg-red-500/10 text-red-600"
          )}
          variant="outline"
        >
          {getHealthLabel(score)}
        </Badge>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <Progress
          className="h-2 flex-1"
          indicatorClassName={getHealthColor(score)}
          value={percentage}
        />
        <span className="font-medium text-xs">{percentage}%</span>
      </div>
      <p className="text-muted-foreground text-xs">{healthInsight}</p>
    </div>
  );
}

function CommunicationPattern({
  pattern,
  metrics,
}: {
  pattern: string;
  metrics: {
    totalThreads: number;
    totalMessages: number;
    avgResponseTimeMinutes: number;
    responseRate: number;
    daysSinceLastContact: number;
    firstInteractionAt: Date | string | null;
    lastInteractionAt: Date | string | null;
  };
}) {
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
        <MessageSquare className="h-3.5 w-3.5" />
        Communication Pattern
      </h4>
      <p className="text-sm">{pattern}</p>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          icon={<Mail className="h-3 w-3" />}
          label="Threads"
          value={metrics.totalThreads.toString()}
        />
        <MetricCard
          icon={<MessageSquare className="h-3 w-3" />}
          label="Messages"
          value={metrics.totalMessages.toString()}
        />
        <MetricCard
          icon={<Clock className="h-3 w-3" />}
          label="Avg Response"
          value={formatResponseTime(metrics.avgResponseTimeMinutes)}
        />
        <MetricCard
          icon={<TrendingUp className="h-3 w-3" />}
          label="Response Rate"
          value={`${Math.round(metrics.responseRate * 100)}%`}
        />
      </div>
      {metrics.lastInteractionAt && (
        <p className="text-[10px] text-muted-foreground">
          Last contact:{" "}
          {formatDistanceToNow(new Date(metrics.lastInteractionAt), {
            addSuffix: true,
          })}
        </p>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <p className="mt-0.5 font-medium text-sm">{value}</p>
    </div>
  );
}

function CommitmentsSection({
  commitments,
}: {
  commitments: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | string | null;
    direction: string;
    isDebtor: boolean;
  }>;
}) {
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Open Commitments ({commitments.length})
      </h4>
      <div className="space-y-1">
        {commitments.map((c) => {
          const isOverdue =
            c.dueDate &&
            isPast(new Date(c.dueDate)) &&
            !isToday(new Date(c.dueDate));
          return (
            <div
              className={cn(
                "rounded-md border p-2 text-xs",
                isOverdue ? "border-red-200 bg-red-50/50" : "bg-background"
              )}
              key={c.id}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 truncate font-medium">{c.title}</p>
                <Badge
                  className="shrink-0 text-[10px]"
                  variant={c.priority === "high" ? "destructive" : "outline"}
                >
                  {c.priority}
                </Badge>
              </div>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <span
                  className={c.isDebtor ? "text-amber-600" : "text-blue-600"}
                >
                  {c.isDebtor ? "They owe" : "You owe"}
                </span>
                {c.dueDate && (
                  <>
                    <span>•</span>
                    <span className={isOverdue ? "text-red-600" : ""}>
                      {isOverdue
                        ? `Overdue by ${formatDistanceToNow(new Date(c.dueDate))}`
                        : `Due ${formatDistanceToNow(new Date(c.dueDate), { addSuffix: true })}`}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DecisionsSection({
  decisions,
}: {
  decisions: Array<{
    id: string;
    title: string;
    decisionDate: Date | string | null;
    status: string | null;
  }>;
}) {
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
        <GitBranch className="h-3.5 w-3.5" />
        Recent Decisions ({decisions.length})
      </h4>
      <div className="space-y-1">
        {decisions.map((d) => (
          <div
            className="rounded-md border bg-background p-2 text-xs"
            key={d.id}
          >
            <p className="truncate font-medium">{d.title}</p>
            {d.decisionDate && (
              <p className="mt-0.5 text-muted-foreground">
                {formatDistanceToNow(new Date(d.decisionDate), {
                  addSuffix: true,
                })}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MutualConnectionsSection({
  contacts,
}: {
  contacts: Array<{
    id: string;
    displayName: string | null;
    primaryEmail: string;
    avatarUrl: string | null;
    company: string | null;
    strength: number;
    relationshipType: string;
  }>;
}) {
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs">
        <Users className="h-3.5 w-3.5" />
        Also Knows ({contacts.length})
      </h4>
      <div className="flex flex-wrap gap-1">
        {contacts.slice(0, 8).map((c) => {
          const initials = c.displayName
            ? c.displayName
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()
            : c.primaryEmail.slice(0, 2).toUpperCase();

          return (
            <TooltipProvider key={c.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar className="h-8 w-8 cursor-pointer border-2 border-background hover:border-primary/50">
                    <AvatarImage src={c.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">
                    {c.displayName ?? c.primaryEmail}
                  </p>
                  {c.company && (
                    <p className="text-muted-foreground text-xs">{c.company}</p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {c.relationshipType.replace("_", " ")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
        {contacts.length > 8 && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed text-[10px] text-muted-foreground">
            +{contacts.length - 8}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex w-80 flex-col border-l bg-background">
      <SidebarHeader onClose={onClose} />
      <div className="space-y-4 p-4">
        {/* Contact header skeleton */}
        <div className="flex items-start gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        {/* Health meter skeleton */}
        <div className="space-y-2 rounded-lg border p-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-40" />
        </div>
        {/* Communication pattern skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-48" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function formatResponseTime(minutes: number): string {
  if (minutes === 0) {
    return "N/A";
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 1440) {
    return `${Math.round(minutes / 60)}h`;
  }
  return `${Math.round(minutes / 1440)}d`;
}
