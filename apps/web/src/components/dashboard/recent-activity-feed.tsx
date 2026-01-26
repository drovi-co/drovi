"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  FileText,
  Lightbulb,
  Mail,
  MessageCircle,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

interface ActivityItem {
  id: string;
  type: "email" | "commitment" | "decision" | "contact" | "message";
  title: string;
  description?: string;
  timestamp: Date;
  icon: LucideIcon;
  iconClassName?: string;
}

function ActivityItemRow({ item }: { item: ActivityItem }) {
  const Icon = item.icon;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          item.iconClassName ?? "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {item.description}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDistanceToNow(item.timestamp, { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="flex items-start gap-3 py-3">
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function RecentActivityFeed() {
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // Fetch recent threads
  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    ...trpc.threads.list.queryOptions({
      limit: 5,
      sort: "recent",
    }),
    enabled: !!organizationId,
  });

  // Fetch recent commitments
  const { data: commitmentsData, isLoading: commitmentsLoading } = useQuery({
    ...trpc.commitments.list.queryOptions({
      organizationId,
      limit: 5,
    }),
    enabled: !!organizationId,
  });

  // Fetch recent decisions
  const { data: decisionsData, isLoading: decisionsLoading } = useQuery({
    ...trpc.decisions.list.queryOptions({
      organizationId,
      limit: 5,
    }),
    enabled: !!organizationId,
  });

  const isLoading = threadsLoading || commitmentsLoading || decisionsLoading;

  // Combine and sort activities
  const activities: ActivityItem[] = [];

  // Add threads
  (threadsData?.threads ?? []).forEach((thread) => {
    activities.push({
      id: `thread-${thread.id}`,
      type: "email",
      title: thread.subject || "No subject",
      description: thread.brief || thread.snippet || undefined,
      timestamp: new Date(thread.updatedAt || thread.createdAt),
      icon: Mail,
      iconClassName: "bg-blue-500/10 text-blue-500",
    });
  });

  // Add commitments
  (commitmentsData?.items ?? []).forEach((commitment) => {
    activities.push({
      id: `commitment-${commitment.id}`,
      type: "commitment",
      title: commitment.title,
      description: commitment.status === "completed"
        ? "Commitment completed"
        : commitment.status === "in_progress"
        ? "In progress"
        : "Pending",
      timestamp: new Date(commitment.updatedAt || commitment.createdAt),
      icon: CheckCircle2,
      iconClassName: "bg-orange-500/10 text-orange-500",
    });
  });

  // Add decisions
  (decisionsData?.items ?? []).forEach((decision) => {
    activities.push({
      id: `decision-${decision.id}`,
      type: "decision",
      title: decision.title,
      description: decision.outcome || undefined,
      timestamp: new Date(decision.date),
      icon: Lightbulb,
      iconClassName: "bg-purple-500/10 text-purple-500",
    });
  });

  // Sort by timestamp descending
  activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Take top 10
  const recentActivities = activities.slice(0, 10);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[320px] pr-4">
          {isLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <ActivitySkeleton key={`skeleton-${i}`} />
              ))}
            </div>
          ) : recentActivities.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No recent activity
            </div>
          ) : (
            <div>
              {recentActivities.map((activity) => (
                <ActivityItemRow item={activity} key={activity.id} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
