"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Inbox,
  Lightbulb,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  trend?: {
    value: number;
    label: string;
    direction: "up" | "down" | "neutral";
  };
  icon: LucideIcon;
  iconClassName?: string;
  isLoading?: boolean;
}

function StatCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  iconClassName,
  isLoading,
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              {title}
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
            {(subtitle || trend) && (
              <div className="mt-1 flex items-center gap-1.5">
                {trend && (
                  <span
                    className={cn(
                      "flex items-center text-xs font-medium",
                      trend.direction === "up" && "text-emerald-600",
                      trend.direction === "down" && "text-red-500",
                      trend.direction === "neutral" && "text-muted-foreground"
                    )}
                  >
                    {trend.direction === "up" && (
                      <ArrowUpRight className="h-3 w-3" />
                    )}
                    {trend.direction === "down" && (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {trend.value > 0 ? "+" : ""}
                    {trend.value}%
                  </span>
                )}
                {subtitle && (
                  <span className="text-muted-foreground text-xs">
                    {subtitle}
                  </span>
                )}
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              iconClassName ?? "bg-primary/10 text-primary"
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewStatCards() {
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // Fetch inbox stats
  const { data: inboxStats, isLoading: inboxLoading } = useQuery({
    ...trpc.threads.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Fetch unified inbox stats for more details
  const { data: unifiedStats, isLoading: unifiedLoading } = useQuery({
    ...trpc.unifiedInbox.getStats.queryOptions(),
    enabled: !!organizationId,
  });

  // Fetch commitment stats
  const { data: commitmentData, isLoading: commitmentsLoading } = useQuery({
    ...trpc.commitments.list.queryOptions({
      organizationId,
      limit: 100,
    }),
    enabled: !!organizationId,
  });

  // Fetch decision stats
  const { data: decisionData, isLoading: decisionsLoading } = useQuery({
    ...trpc.decisions.list.queryOptions({
      organizationId,
      limit: 100,
    }),
    enabled: !!organizationId,
  });

  // Fetch contacts
  const { data: contactsData, isLoading: contactsLoading } = useQuery({
    ...trpc.contacts.list.queryOptions({
      organizationId,
      limit: 100,
    }),
    enabled: !!organizationId,
  });

  // Calculate stats
  const unreadCount = inboxStats?.unread ?? unifiedStats?.unread ?? 0;

  const commitments = commitmentData?.items ?? [];
  const activeCommitments = commitments.filter(
    (c) => c.status === "pending" || c.status === "in_progress"
  ).length;
  const overdueCommitments = commitments.filter(
    (c) =>
      c.dueDate &&
      new Date(c.dueDate) < new Date() &&
      c.status !== "completed" &&
      c.status !== "cancelled"
  ).length;

  const decisions = decisionData?.items ?? [];
  const thisWeekDecisions = decisions.filter((d) => {
    const decisionDate = new Date(d.date);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return decisionDate >= weekAgo;
  }).length;

  const contacts = contactsData?.items ?? [];
  const vipContacts = contacts.filter(
    (c) => c.healthScore && c.healthScore >= 80
  ).length;
  const atRiskContacts = contacts.filter(
    (c) => c.healthScore && c.healthScore < 40
  ).length;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Inbox}
        iconClassName="bg-blue-500/10 text-blue-500"
        isLoading={inboxLoading || unifiedLoading}
        subtitle="in your inbox"
        title="Unread"
        value={unreadCount}
      />

      <StatCard
        icon={CheckCircle2}
        iconClassName="bg-orange-500/10 text-orange-500"
        isLoading={commitmentsLoading}
        subtitle={overdueCommitments > 0 ? `${overdueCommitments} overdue` : "active"}
        title="Commitments"
        value={activeCommitments}
      />

      <StatCard
        icon={Lightbulb}
        iconClassName="bg-purple-500/10 text-purple-500"
        isLoading={decisionsLoading}
        subtitle="this week"
        title="Decisions"
        value={thisWeekDecisions}
      />

      <StatCard
        icon={Users}
        iconClassName="bg-emerald-500/10 text-emerald-500"
        isLoading={contactsLoading}
        subtitle={atRiskContacts > 0 ? `${atRiskContacts} at risk` : "healthy relationships"}
        title="VIP Contacts"
        value={vipContacts}
      />
    </div>
  );
}
