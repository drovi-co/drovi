// =============================================================================
// ALERTS MANAGEMENT COMPONENT
// =============================================================================
//
// Comprehensive UI for viewing and managing contact intelligence alerts.
// Supports filtering, bulk actions, and detailed alert views.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  Filter,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface AlertsManagementProps {
  organizationId: string;
  contactId?: string;
  onContactClick?: (contactId: string) => void;
  className?: string;
}

type AlertSeverity = "critical" | "high" | "medium" | "low";
type AlertStatus =
  | "active"
  | "acknowledged"
  | "snoozed"
  | "resolved"
  | "dismissed";
type AlertType =
  | "vip_silence"
  | "relationship_degradation"
  | "commitment_breach_pattern"
  | "long_silence"
  | "engagement_spike";

// =============================================================================
// CONSTANTS
// =============================================================================

const severityConfig: Record<
  AlertSeverity,
  { color: string; bgColor: string; icon: React.ElementType; label: string }
> = {
  critical: {
    color: "text-red-600",
    bgColor: "bg-red-500/10 border-red-500/30",
    icon: AlertCircle,
    label: "Critical",
  },
  high: {
    color: "text-orange-600",
    bgColor: "bg-orange-500/10 border-orange-500/30",
    icon: AlertTriangle,
    label: "High",
  },
  medium: {
    color: "text-amber-600",
    bgColor: "bg-amber-500/10 border-amber-500/30",
    icon: Bell,
    label: "Medium",
  },
  low: {
    color: "text-blue-600",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    icon: Bell,
    label: "Low",
  },
};

const typeConfig: Record<
  AlertType,
  { icon: React.ElementType; label: string }
> = {
  vip_silence: { icon: User, label: "VIP Silence" },
  relationship_degradation: {
    icon: TrendingDown,
    label: "Relationship Degradation",
  },
  commitment_breach_pattern: { icon: Target, label: "Commitment Breach" },
  long_silence: { icon: Clock, label: "Long Silence" },
  engagement_spike: { icon: Sparkles, label: "Engagement Spike" },
};

// =============================================================================
// SUMMARY CARD
// =============================================================================

interface SummaryCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
  isActive?: boolean;
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  color,
  onClick,
  isActive,
}: SummaryCardProps) {
  return (
    <motion.button
      className={cn(
        "rounded-xl border p-4 text-left transition-all",
        onClick && "cursor-pointer hover:border-foreground/20",
        isActive && "ring-2 ring-primary"
      )}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{label}</span>
        <Icon className={cn("h-5 w-5", color)} />
      </div>
      <p className="mt-2 font-bold text-3xl">{value}</p>
    </motion.button>
  );
}

// =============================================================================
// ALERT ROW COMPONENT
// =============================================================================

interface AlertRowProps {
  alert: {
    id: string;
    alertType: string;
    severity: string;
    status: string;
    message: string;
    description?: string | null;
    contact: {
      id: string;
      displayName?: string | null;
      primaryEmail?: string | null;
      avatarUrl?: string | null;
      isVip?: boolean | null;
    };
    createdAt: Date | string;
    acknowledgedAt?: Date | string | null;
  };
  isSelected: boolean;
  onSelect: () => void;
  onAcknowledge: () => void;
  onDismiss: () => void;
  onResolve: () => void;
  onViewContact: () => void;
  onViewDetails: () => void;
}

function AlertRow({
  alert,
  isSelected,
  onSelect,
  onAcknowledge,
  onDismiss,
  onResolve,
  onViewContact,
  onViewDetails,
}: AlertRowProps) {
  const severity =
    severityConfig[alert.severity as AlertSeverity] ?? severityConfig.medium;
  const type = typeConfig[alert.alertType as AlertType];
  const SeverityIcon = severity.icon;
  const TypeIcon = type?.icon ?? Bell;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group flex items-center gap-4 rounded-lg border p-4 transition-all",
        severity.bgColor,
        isSelected && "ring-2 ring-primary"
      )}
      initial={{ opacity: 0, y: 10 }}
      layout
    >
      {/* Checkbox */}
      <button
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30 hover:border-primary"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        type="button"
      >
        {isSelected && <Check className="h-3 w-3" />}
      </button>

      {/* Severity Icon */}
      <div className={cn("shrink-0", severity.color)}>
        <SeverityIcon className="h-5 w-5" />
      </div>

      {/* Contact Avatar */}
      <button onClick={onViewContact} type="button">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={alert.contact.avatarUrl ?? undefined} />
          <AvatarFallback className="text-xs">
            {(
              alert.contact.displayName?.slice(0, 2) ??
              alert.contact.primaryEmail?.slice(0, 2) ??
              "?"
            ).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{alert.message}</span>
          <Badge className="text-[10px]" variant="outline">
            <TypeIcon className="mr-1 h-3 w-3" />
            {type?.label ?? alert.alertType}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-muted-foreground text-xs">
          <span>{alert.contact.displayName ?? alert.contact.primaryEmail}</span>
          <span>•</span>
          <span>
            {formatDistanceToNow(new Date(alert.createdAt), {
              addSuffix: true,
            })}
          </span>
          {alert.acknowledgedAt && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                Acknowledged
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {alert.status === "active" && (
          <Button
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onAcknowledge();
            }}
            size="icon"
            title="Acknowledge"
            variant="ghost"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        <Button
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
          size="icon"
          title="Resolve"
          variant="ghost"
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="h-8 w-8"
              onClick={(e) => e.stopPropagation()}
              size="icon"
              variant="ghost"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onViewDetails}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onViewContact}>
              <User className="mr-2 h-4 w-4" />
              View Contact
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDismiss}>
              <BellOff className="mr-2 h-4 w-4" />
              Dismiss
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}

// =============================================================================
// ALERT DETAIL SHEET
// =============================================================================

interface AlertDetailSheetProps {
  alert: {
    id: string;
    alertType: string;
    severity: string;
    status: string;
    message: string;
    description?: string | null;
    context?: Record<string, unknown> | null;
    contact: {
      id: string;
      displayName?: string | null;
      primaryEmail?: string | null;
      company?: string | null;
      avatarUrl?: string | null;
      isVip?: boolean | null;
    };
    createdAt: Date | string;
    acknowledgedAt?: Date | string | null;
    resolvedAt?: Date | string | null;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onViewContact: () => void;
}

function AlertDetailSheet({
  alert,
  isOpen,
  onClose,
  onAcknowledge,
  onResolve,
  onDismiss,
  onViewContact,
}: AlertDetailSheetProps) {
  if (!alert) {
    return null;
  }

  const severity =
    severityConfig[alert.severity as AlertSeverity] ?? severityConfig.medium;
  const type = typeConfig[alert.alertType as AlertType];
  const SeverityIcon = severity.icon;

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={isOpen}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className={cn("rounded-lg p-2", severity.bgColor)}>
              <SeverityIcon className={cn("h-6 w-6", severity.color)} />
            </div>
            <div>
              <SheetTitle className="text-left">
                {type?.label ?? alert.alertType}
              </SheetTitle>
              <SheetDescription className="text-left">
                {format(new Date(alert.createdAt), "PPpp")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Contact Card */}
          <Card
            className="cursor-pointer hover:bg-accent/50"
            onClick={onViewContact}
          >
            <CardContent className="flex items-center gap-4 p-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={alert.contact.avatarUrl ?? undefined} />
                <AvatarFallback>
                  {(
                    alert.contact.displayName?.slice(0, 2) ??
                    alert.contact.primaryEmail?.slice(0, 2) ??
                    "?"
                  ).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{alert.contact.displayName}</p>
                <p className="text-muted-foreground text-sm">
                  {alert.contact.company ?? alert.contact.primaryEmail}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Alert Message */}
          <div>
            <h4 className="mb-2 font-medium text-sm">Alert</h4>
            <p className="text-foreground">{alert.message}</p>
            {alert.description && (
              <p className="mt-2 text-muted-foreground text-sm">
                {alert.description}
              </p>
            )}
          </div>

          {/* Context Data */}
          {alert.context && Object.keys(alert.context).length > 0 && (
            <div>
              <h4 className="mb-2 font-medium text-sm">Details</h4>
              <Card>
                <CardContent className="grid grid-cols-2 gap-4 p-4">
                  {Object.entries(alert.context).map(([key, value]) => (
                    <div key={key}>
                      <p className="text-muted-foreground text-xs capitalize">
                        {key.replace(/_/g, " ")}
                      </p>
                      <p className="font-medium text-sm">
                        {typeof value === "number"
                          ? value.toLocaleString()
                          : String(value)}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Status Timeline */}
          <div>
            <h4 className="mb-2 font-medium text-sm">Timeline</h4>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                  <Bell className="h-3 w-3" />
                </div>
                <span className="text-sm">
                  Created{" "}
                  {formatDistanceToNow(new Date(alert.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              {alert.acknowledgedAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10">
                    <Eye className="h-3 w-3 text-blue-600" />
                  </div>
                  <span className="text-sm">
                    Acknowledged{" "}
                    {formatDistanceToNow(new Date(alert.acknowledgedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              )}
              {alert.resolvedAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10">
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                  </div>
                  <span className="text-sm">
                    Resolved{" "}
                    {formatDistanceToNow(new Date(alert.resolvedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {alert.status === "active" && (
              <Button
                className="flex-1"
                onClick={onAcknowledge}
                variant="outline"
              >
                <Eye className="mr-2 h-4 w-4" />
                Acknowledge
              </Button>
            )}
            <Button className="flex-1" onClick={onResolve}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Resolve
            </Button>
          </div>
          <Button className="w-full" onClick={onDismiss} variant="ghost">
            <BellOff className="mr-2 h-4 w-4" />
            Dismiss Alert
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AlertsManagement({
  organizationId,
  contactId,
  onContactClick,
  className,
}: AlertsManagementProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity[]>([]);
  const [statusFilter, setStatusFilter] = useState<AlertStatus[]>(["active"]);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailAlert, setDetailAlert] = useState<
    NonNullable<typeof alerts>["alerts"][0] | null
  >(null);

  // Queries
  const {
    data: alerts,
    isLoading,
    refetch,
  } = useQuery(
    trpc.contactIntelligence.listAlerts.queryOptions({
      organizationId,
      contactId,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      severity: severityFilter.length > 0 ? severityFilter : undefined,
      limit: 100,
    })
  );

  const { data: summary } = useQuery(
    trpc.contactIntelligence.getAlertSummary.queryOptions({
      organizationId,
    })
  );

  // Mutations
  const acknowledgeMutation = useMutation(
    trpc.contactIntelligence.acknowledgeAlert.mutationOptions({
      onSuccess: () => {
        refetch();
        setSelectedIds(new Set());
      },
    })
  );

  const dismissMutation = useMutation(
    trpc.contactIntelligence.dismissAlert.mutationOptions({
      onSuccess: () => {
        refetch();
        setSelectedIds(new Set());
      },
    })
  );

  const resolveMutation = useMutation(
    trpc.contactIntelligence.resolveAlert.mutationOptions({
      onSuccess: () => {
        refetch();
        setSelectedIds(new Set());
        setDetailAlert(null);
      },
    })
  );

  const batchUpdateMutation = useMutation(
    trpc.contactIntelligence.batchUpdateAlerts.mutationOptions({
      onSuccess: () => {
        refetch();
        setSelectedIds(new Set());
      },
    })
  );

  // Filter alerts by search query
  const filteredAlerts = useMemo(() => {
    if (!alerts?.alerts) {
      return [];
    }
    if (!searchQuery) {
      return alerts.alerts;
    }

    const query = searchQuery.toLowerCase();
    return alerts.alerts.filter(
      (alert) =>
        alert.message.toLowerCase().includes(query) ||
        alert.contact.displayName?.toLowerCase().includes(query) ||
        alert.contact.primaryEmail?.toLowerCase().includes(query)
    );
  }, [alerts, searchQuery]);

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all
  const selectAll = () => {
    if (selectedIds.size === filteredAlerts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAlerts.map((a) => a.id)));
    }
  };

  // Batch actions
  const handleBatchAction = (action: "acknowledge" | "dismiss" | "resolve") => {
    if (selectedIds.size === 0) {
      return;
    }
    batchUpdateMutation.mutate({
      organizationId,
      alertIds: Array.from(selectedIds),
      action,
    });
  };

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="grid grid-cols-4 gap-4">
          {[...new Array(4)].map((_, i) => (
            <Skeleton className="h-24 w-full rounded-xl" key={i} />
          ))}
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="space-y-3">
          {[...new Array(5)].map((_, i) => (
            <Skeleton className="h-20 w-full" key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          color="text-red-500"
          icon={AlertCircle}
          isActive={severityFilter.includes("critical")}
          label="Critical"
          onClick={() =>
            setSeverityFilter((prev) =>
              prev.includes("critical")
                ? prev.filter((s) => s !== "critical")
                : [...prev, "critical"]
            )
          }
          value={summary?.bySeverity?.critical ?? 0}
        />
        <SummaryCard
          color="text-orange-500"
          icon={AlertTriangle}
          isActive={severityFilter.includes("high")}
          label="High Priority"
          onClick={() =>
            setSeverityFilter((prev) =>
              prev.includes("high")
                ? prev.filter((s) => s !== "high")
                : [...prev, "high"]
            )
          }
          value={summary?.bySeverity?.high ?? 0}
        />
        <SummaryCard
          color="text-amber-500"
          icon={Bell}
          label="Total Active"
          value={summary?.totalActive ?? 0}
        />
        <SummaryCard
          color="text-purple-500"
          icon={User}
          label="VIP Alerts"
          value={summary?.byType?.vip_silence ?? 0}
        />
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search alerts..."
              value={searchQuery}
            />
          </div>

          {/* Status Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-2" variant="outline">
                <Filter className="h-4 w-4" />
                Status
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(
                [
                  "active",
                  "acknowledged",
                  "snoozed",
                  "resolved",
                  "dismissed",
                ] as AlertStatus[]
              ).map((status) => (
                <DropdownMenuCheckboxItem
                  checked={statusFilter.includes(status)}
                  key={status}
                  onCheckedChange={(checked) => {
                    setStatusFilter((prev) =>
                      checked
                        ? [...prev, status]
                        : prev.filter((s) => s !== status)
                    );
                  }}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <>
              <div className="h-6 w-px bg-border" />
              <span className="text-muted-foreground text-sm">
                {selectedIds.size} selected
              </span>
              <Button
                onClick={() => handleBatchAction("acknowledge")}
                size="sm"
                variant="outline"
              >
                <Eye className="mr-2 h-4 w-4" />
                Acknowledge
              </Button>
              <Button
                onClick={() => handleBatchAction("resolve")}
                size="sm"
                variant="outline"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Resolve
              </Button>
              <Button
                onClick={() => handleBatchAction("dismiss")}
                size="sm"
                variant="ghost"
              >
                <BellOff className="mr-2 h-4 w-4" />
                Dismiss
              </Button>
            </>
          )}

          {/* Refresh */}
          <Button onClick={() => refetch()} size="icon" variant="ghost">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Alert List */}
      <div className="space-y-3">
        {/* Select All */}
        {filteredAlerts.length > 0 && (
          <div className="flex items-center gap-2 px-4">
            <button
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                selectedIds.size === filteredAlerts.length
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30 hover:border-primary"
              )}
              onClick={selectAll}
              type="button"
            >
              {selectedIds.size === filteredAlerts.length && (
                <Check className="h-3 w-3" />
              )}
            </button>
            <span className="text-muted-foreground text-sm">
              Select all ({filteredAlerts.length})
            </span>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {filteredAlerts.map((alert) => (
            <AlertRow
              alert={alert}
              isSelected={selectedIds.has(alert.id)}
              key={alert.id}
              onAcknowledge={() =>
                acknowledgeMutation.mutate({
                  organizationId,
                  alertId: alert.id,
                })
              }
              onDismiss={() =>
                dismissMutation.mutate({ organizationId, alertId: alert.id })
              }
              onResolve={() =>
                resolveMutation.mutate({ organizationId, alertId: alert.id })
              }
              onSelect={() => toggleSelect(alert.id)}
              onViewContact={() => onContactClick?.(alert.contact.id)}
              onViewDetails={() => setDetailAlert(alert)}
            />
          ))}
        </AnimatePresence>

        {filteredAlerts.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div className="text-center">
                <p className="font-medium">All Clear</p>
                <p className="text-muted-foreground text-sm">
                  No alerts match your current filters
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detail Sheet */}
      <AlertDetailSheet
        alert={detailAlert}
        isOpen={!!detailAlert}
        onAcknowledge={() => {
          if (detailAlert) {
            acknowledgeMutation.mutate({
              organizationId,
              alertId: detailAlert.id,
            });
          }
        }}
        onClose={() => setDetailAlert(null)}
        onDismiss={() => {
          if (detailAlert) {
            dismissMutation.mutate({ organizationId, alertId: detailAlert.id });
            setDetailAlert(null);
          }
        }}
        onResolve={() => {
          if (detailAlert) {
            resolveMutation.mutate({ organizationId, alertId: detailAlert.id });
          }
        }}
        onViewContact={() => {
          if (detailAlert) {
            onContactClick?.(detailAlert.contact.id);
            setDetailAlert(null);
          }
        }}
      />
    </div>
  );
}

export default AlertsManagement;
