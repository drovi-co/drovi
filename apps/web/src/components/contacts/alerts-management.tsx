// =============================================================================
// ALERTS MANAGEMENT COMPONENT
// =============================================================================
//
// Comprehensive UI for viewing and managing contact intelligence alerts.
// Supports filtering, bulk actions, and detailed alert views.
//

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
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
  Heart,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  User,
  Users,
  X,
} from "lucide-react";
import { useState, useMemo } from "react";

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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface AlertsManagementProps {
  organizationId: string;
  onContactClick?: (contactId: string) => void;
  className?: string;
}

type AlertSeverity = "critical" | "high" | "medium" | "low";
type AlertStatus = "active" | "acknowledged" | "snoozed" | "resolved" | "dismissed";
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

const typeConfig: Record<AlertType, { icon: React.ElementType; label: string }> = {
  vip_silence: { icon: User, label: "VIP Silence" },
  relationship_degradation: { icon: TrendingDown, label: "Relationship Degradation" },
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
      isVip?: boolean;
    };
    createdAt: Date;
    acknowledgedAt?: Date | null;
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
  const severity = severityConfig[alert.severity as AlertSeverity] ?? severityConfig.medium;
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
          <Badge variant="outline" className="text-[10px]">
            <TypeIcon className="mr-1 h-3 w-3" />
            {type?.label ?? alert.alertType}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-muted-foreground text-xs">
          <span>{alert.contact.displayName ?? alert.contact.primaryEmail}</span>
          <span>•</span>
          <span>
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
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
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onAcknowledge();
            }}
            title="Acknowledge"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
          title="Resolve"
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={(e) => e.stopPropagation()}
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
      isVip?: boolean;
    };
    createdAt: Date;
    acknowledgedAt?: Date | null;
    resolvedAt?: Date | null;
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
  if (!alert) return null;

  const severity = severityConfig[alert.severity as AlertSeverity] ?? severityConfig.medium;
  const type = typeConfig[alert.alertType as AlertType];
  const SeverityIcon = severity.icon;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className={cn("rounded-lg p-2", severity.bgColor)}>
              <SeverityIcon className={cn("h-6 w-6", severity.color)} />
            </div>
            <div>
              <SheetTitle className="text-left">{type?.label ?? alert.alertType}</SheetTitle>
              <SheetDescription className="text-left">
                {format(new Date(alert.createdAt), "PPpp")}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Contact Card */}
          <Card className="cursor-pointer hover:bg-accent/50" onClick={onViewContact}>
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
              <p className="mt-2 text-muted-foreground text-sm">{alert.description}</p>
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
                  Created {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                </span>
              </div>
              {alert.acknowledgedAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10">
                    <Eye className="h-3 w-3 text-blue-600" />
                  </div>
                  <span className="text-sm">
                    Acknowledged{" "}
                    {formatDistanceToNow(new Date(alert.acknowledgedAt), { addSuffix: true })}
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
                    {formatDistanceToNow(new Date(alert.resolvedAt), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {alert.status === "active" && (
              <Button variant="outline" className="flex-1" onClick={onAcknowledge}>
                <Eye className="mr-2 h-4 w-4" />
                Acknowledge
              </Button>
            )}
            <Button className="flex-1" onClick={onResolve}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Resolve
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={onDismiss}>
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
  const [detailAlert, setDetailAlert] = useState<typeof alerts.alerts[0] | null>(null);

  // Queries
  const { data: alerts, isLoading, refetch } = useQuery(
    trpc.contactIntelligence.listAlerts.queryOptions({
      organizationId,
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
    if (!alerts?.alerts) return [];
    if (!searchQuery) return alerts.alerts;

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
    if (selectedIds.size === 0) return;
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
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
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
          label="Critical"
          value={summary?.bySeverity?.critical ?? 0}
          icon={AlertCircle}
          color="text-red-500"
          onClick={() =>
            setSeverityFilter((prev) =>
              prev.includes("critical")
                ? prev.filter((s) => s !== "critical")
                : [...prev, "critical"]
            )
          }
          isActive={severityFilter.includes("critical")}
        />
        <SummaryCard
          label="High Priority"
          value={summary?.bySeverity?.high ?? 0}
          icon={AlertTriangle}
          color="text-orange-500"
          onClick={() =>
            setSeverityFilter((prev) =>
              prev.includes("high")
                ? prev.filter((s) => s !== "high")
                : [...prev, "high"]
            )
          }
          isActive={severityFilter.includes("high")}
        />
        <SummaryCard
          label="Total Active"
          value={summary?.totalActive ?? 0}
          icon={Bell}
          color="text-amber-500"
        />
        <SummaryCard
          label="VIP Alerts"
          value={summary?.byType?.vip_silence ?? 0}
          icon={User}
          color="text-purple-500"
        />
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search alerts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Status
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["active", "acknowledged", "snoozed", "resolved", "dismissed"] as AlertStatus[]).map(
                (status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={statusFilter.includes(status)}
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
                )
              )}
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
                size="sm"
                variant="outline"
                onClick={() => handleBatchAction("acknowledge")}
              >
                <Eye className="mr-2 h-4 w-4" />
                Acknowledge
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBatchAction("resolve")}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Resolve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleBatchAction("dismiss")}
              >
                <BellOff className="mr-2 h-4 w-4" />
                Dismiss
              </Button>
            </>
          )}

          {/* Refresh */}
          <Button size="icon" variant="ghost" onClick={() => refetch()}>
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
              key={alert.id}
              alert={alert}
              isSelected={selectedIds.has(alert.id)}
              onSelect={() => toggleSelect(alert.id)}
              onAcknowledge={() =>
                acknowledgeMutation.mutate({ organizationId, alertId: alert.id })
              }
              onDismiss={() =>
                dismissMutation.mutate({ organizationId, alertId: alert.id })
              }
              onResolve={() =>
                resolveMutation.mutate({ organizationId, alertId: alert.id })
              }
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
        onClose={() => setDetailAlert(null)}
        onAcknowledge={() => {
          if (detailAlert) {
            acknowledgeMutation.mutate({ organizationId, alertId: detailAlert.id });
          }
        }}
        onResolve={() => {
          if (detailAlert) {
            resolveMutation.mutate({ organizationId, alertId: detailAlert.id });
          }
        }}
        onDismiss={() => {
          if (detailAlert) {
            dismissMutation.mutate({ organizationId, alertId: detailAlert.id });
            setDetailAlert(null);
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
