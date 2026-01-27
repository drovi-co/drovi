// =============================================================================
// BLINDSPOT DETECTION PANEL
// =============================================================================
//
// Surfaces organizational blindspots using Deming's System of Profound Knowledge.
// Types: decision_vacuum, responsibility_gap, recurring_question, ignored_risk,
// communication_silo.
//

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Eye,
  GitBranch,
  HelpCircle,
  Loader2,
  MessageSquare,
  Shield,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  BlindspotIndicator,
  BlindspotSeverity,
} from "@/hooks/use-intelligence";
import { useBlindspots, useDismissBlindspot } from "@/hooks/use-intelligence";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface BlindspotPanelProps {
  organizationId: string;
  className?: string;
}

// =============================================================================
// BLINDSPOT TYPE CONFIGURATION
// =============================================================================

const DEFAULT_BLINDSPOT_CONFIG = {
  icon: HelpCircle,
  label: "Unknown",
  description: "Unknown blindspot type",
  color: "text-gray-500",
  bgColor: "bg-gray-100",
};

const BLINDSPOT_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    label: string;
    description: string;
    color: string;
    bgColor: string;
  }
> = {
  decision_vacuum: {
    icon: GitBranch,
    label: "Decision Vacuum",
    description: "Active topic with no decisions made",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  responsibility_gap: {
    icon: CircleDot,
    label: "Responsibility Gap",
    description: "Work mentioned but no owner assigned",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
  },
  recurring_question: {
    icon: HelpCircle,
    label: "Recurring Question",
    description: "Same question keeps appearing without resolution",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  ignored_risk: {
    icon: Shield,
    label: "Ignored Risk",
    description: "Risk detected but not addressed",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
  },
  communication_silo: {
    icon: MessageSquare,
    label: "Communication Silo",
    description: "Information not reaching relevant stakeholders",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
};

const SEVERITY_CONFIG: Record<
  BlindspotSeverity,
  { label: string; color: string; bgColor: string }
> = {
  low: {
    label: "Low",
    color: "text-gray-500",
    bgColor: "bg-gray-500/10 border-gray-500/30",
  },
  medium: {
    label: "Medium",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10 border-amber-500/30",
  },
  high: {
    label: "High",
    color: "text-red-500",
    bgColor: "bg-red-500/10 border-red-500/30",
  },
};

// =============================================================================
// BLINDSPOT CARD COMPONENT
// =============================================================================

interface BlindspotCardProps {
  blindspot: BlindspotIndicator;
  onDismiss: (id: string, reason?: string) => void;
  isDismissing: boolean;
}

function BlindspotCard({
  blindspot,
  onDismiss,
  isDismissing,
}: BlindspotCardProps) {
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const config =
    BLINDSPOT_CONFIG[blindspot.blindspot_type] ?? DEFAULT_BLINDSPOT_CONFIG;
  const severityConfig = SEVERITY_CONFIG[blindspot.severity];
  const Icon = config.icon;

  const handleDismiss = () => {
    onDismiss(blindspot.id, dismissReason || undefined);
    setShowDismissDialog(false);
    setDismissReason("");
  };

  return (
    <>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-xl border bg-card p-4 transition-shadow hover:shadow-md"
        initial={{ opacity: 0, y: 10 }}
      >
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={cn("rounded-lg p-2", config.bgColor)}>
            <Icon className={cn("h-5 w-5", config.color)} />
          </div>

          {/* Content */}
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{blindspot.title}</h4>
                  <Badge
                    className={cn("text-xs", severityConfig.bgColor)}
                    variant="outline"
                  >
                    {severityConfig.label}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">{config.label}</p>
              </div>

              {/* Dismiss button */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-8 w-8 shrink-0"
                      disabled={isDismissing}
                      onClick={() => setShowDismissDialog(true)}
                      size="icon"
                      variant="ghost"
                    >
                      {isDismissing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Dismiss this blindspot</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <p className="text-sm">{blindspot.description}</p>

            {/* Suggested action */}
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-2 text-sm">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{blindspot.suggested_action}</span>
            </div>

            {/* Evidence links */}
            {blindspot.evidence_ids.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {blindspot.evidence_ids.slice(0, 3).map((evidenceId) => (
                  <Badge
                    className="cursor-pointer text-xs hover:bg-primary/20"
                    key={evidenceId}
                    variant="secondary"
                  >
                    {evidenceId.slice(0, 8)}...
                  </Badge>
                ))}
                {blindspot.evidence_ids.length > 3 && (
                  <Badge className="text-xs" variant="secondary">
                    +{blindspot.evidence_ids.length - 3} more
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Dismiss Dialog */}
      <Dialog onOpenChange={setShowDismissDialog} open={showDismissDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Blindspot</DialogTitle>
            <DialogDescription>
              Help us improve by telling us why this blindspot is not relevant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason"
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="e.g., Already addressed in meeting, False positive..."
                value={dismissReason}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setShowDismissDialog(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isDismissing} onClick={handleDismiss}>
              {isDismissing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Dismissing...
                </>
              ) : (
                "Dismiss"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function BlindspotPanel({
  organizationId,
  className,
}: BlindspotPanelProps) {
  const { data, isLoading, refetch } = useBlindspots({ organizationId });
  const dismissMutation = useDismissBlindspot();

  const handleDismiss = (blindspotId: string, reason?: string) => {
    dismissMutation.mutate(
      { organizationId, blindspotId, reason },
      {
        onSuccess: () => {
          toast.success("Blindspot dismissed");
          refetch();
        },
        onError: () => {
          toast.error("Failed to dismiss blindspot");
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Blindspot Detection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const blindspots = data?.blindspots ?? [];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Blindspot Detection
          {blindspots.length > 0 && (
            <Badge className="ml-2" variant="secondary">
              {blindspots.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Organizational areas that may need attention (Deming&apos;s System of
          Profound Knowledge)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {blindspots.length === 0 ? (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-8 text-center"
            initial={{ opacity: 0, scale: 0.95 }}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <h3 className="font-medium">No Blindspots Detected</h3>
            <p className="mt-1 text-muted-foreground text-sm">
              Your organization has good visibility across all areas.
            </p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {blindspots.map((blindspot) => (
              <BlindspotCard
                blindspot={blindspot}
                isDismissing={dismissMutation.isPending}
                key={blindspot.id}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default BlindspotPanel;
