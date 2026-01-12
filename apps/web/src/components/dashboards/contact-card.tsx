// =============================================================================
// CONTACT CARD COMPONENT
// =============================================================================
//
// Intelligence-first contact display showing relationship health, importance,
// open loops, and interaction history. This isn't a contact card - it's a
// relationship intelligence surface.
//

import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Heart,
  Linkedin,
  Mail,
  MoreHorizontal,
  Phone,
  Star,
  StarOff,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ContactCardData {
  id: string;
  displayName?: string | null;
  primaryEmail: string;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  avatarUrl?: string | null;
  // Relationship Intelligence
  isVip: boolean;
  isAtRisk: boolean;
  importanceScore?: number | null;
  healthScore?: number | null;
  engagementScore?: number | null;
  sentimentScore?: number | null;
  // Interaction Stats
  totalThreads?: number | null;
  totalMessages?: number | null;
  firstInteractionAt?: Date | null;
  lastInteractionAt?: Date | null;
  // Communication patterns
  avgResponseTimeHours?: number | null;
  responseRate?: number | null;
  // Open loops
  openCommitmentsCount?: number;
  pendingQuestionsCount?: number;
  tags?: string[] | null;
}

interface ContactCardProps {
  contact: ContactCardData;
  isSelected?: boolean;
  onSelect?: () => void;
  onToggleVip?: (contactId: string) => void;
  onEmailClick?: (email: string) => void;
  onViewProfile?: (contactId: string) => void;
  onGenerateMeetingBrief?: (contactId: string) => void;
  compact?: boolean;
}

// =============================================================================
// HELPERS
// =============================================================================

function getHealthColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 0.7) return "text-green-600 dark:text-green-400";
  if (score >= 0.4) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ContactCard({
  contact,
  isSelected = false,
  onSelect,
  onToggleVip,
  onEmailClick,
  onViewProfile,
  onGenerateMeetingBrief,
  compact = false,
}: ContactCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayName = contact.displayName ?? contact.primaryEmail.split("@")[0];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "group relative rounded-lg border bg-card transition-all",
        "hover:shadow-md cursor-pointer",
        contact.isAtRisk && "border-l-4 border-l-red-500",
        contact.isVip && !contact.isAtRisk && "border-l-4 border-l-amber-500",
        isSelected && "ring-2 ring-primary",
        compact ? "p-3" : "p-4"
      )}
      onClick={onSelect}
    >
      {/* Main Content */}
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <Avatar className={cn(compact ? "h-10 w-10" : "h-12 w-12")}>
          <AvatarImage src={contact.avatarUrl ?? undefined} alt={displayName} />
          <AvatarFallback className="bg-primary/10 text-primary">
            {getInitials(contact.displayName, contact.primaryEmail)}
          </AvatarFallback>
        </Avatar>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Name */}
            <h3 className={cn(
              "font-medium text-foreground truncate",
              compact ? "text-sm" : "text-base"
            )}>
              {displayName}
            </h3>

            {/* VIP Badge */}
            {contact.isVip && (
              <Star className="h-4 w-4 text-amber-500 fill-amber-500 shrink-0" />
            )}

            {/* At-Risk Badge */}
            {contact.isAtRisk && (
              <Badge variant="destructive" className="text-xs shrink-0">
                <TrendingDown className="h-3 w-3 mr-1" />
                At Risk
              </Badge>
            )}
          </div>

          {/* Title & Company */}
          {(contact.title || contact.company) && (
            <p className="text-sm text-muted-foreground truncate">
              {contact.title}
              {contact.title && contact.company && " at "}
              {contact.company}
            </p>
          )}

          {/* Email */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEmailClick?.(contact.primaryEmail);
            }}
            className="text-sm text-primary hover:underline truncate block"
          >
            {contact.primaryEmail}
          </button>

          {/* Stats Row */}
          <div className="flex items-center gap-4 mt-2">
            {/* Health Score */}
            {contact.healthScore !== null && contact.healthScore !== undefined && (
              <div className="flex items-center gap-1.5">
                <Heart className={cn("h-3.5 w-3.5", getHealthColor(contact.healthScore))} />
                <span className={cn("text-xs font-medium", getHealthColor(contact.healthScore))}>
                  {Math.round(contact.healthScore * 100)}%
                </span>
              </div>
            )}

            {/* Importance Score */}
            {contact.importanceScore !== null && contact.importanceScore !== undefined && (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {Math.round(contact.importanceScore * 100)}% importance
                </span>
              </div>
            )}

            {/* Last Interaction */}
            {contact.lastInteractionAt && (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(contact.lastInteractionAt, { addSuffix: true })}
                </span>
              </div>
            )}
          </div>

          {/* Open Loops Warning */}
          {((contact.openCommitmentsCount ?? 0) > 0 || (contact.pendingQuestionsCount ?? 0) > 0) && (
            <div className="flex items-center gap-2 mt-2">
              {(contact.openCommitmentsCount ?? 0) > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {contact.openCommitmentsCount} open commitments
                </Badge>
              )}
              {(contact.pendingQuestionsCount ?? 0) > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {contact.pendingQuestionsCount} pending questions
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Expand Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>

          {/* VIP Toggle */}
          {onToggleVip && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVip(contact.id);
              }}
              title={contact.isVip ? "Remove VIP" : "Mark as VIP"}
            >
              {contact.isVip ? (
                <StarOff className="h-4 w-4" />
              ) : (
                <Star className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* More Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewProfile?.(contact.id)}>
                <User className="h-4 w-4 mr-2" />
                View Full Profile
              </DropdownMenuItem>
              {onGenerateMeetingBrief && (
                <DropdownMenuItem onClick={() => onGenerateMeetingBrief(contact.id)}>
                  <Calendar className="h-4 w-4 mr-2" />
                  Generate Meeting Brief
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onEmailClick?.(contact.primaryEmail)}>
                <Mail className="h-4 w-4 mr-2" />
                Send Email
              </DropdownMenuItem>
              {contact.phone && (
                <DropdownMenuItem asChild>
                  <a href={`tel:${contact.phone}`}>
                    <Phone className="h-4 w-4 mr-2" />
                    Call
                  </a>
                </DropdownMenuItem>
              )}
              {contact.linkedinUrl && (
                <DropdownMenuItem asChild>
                  <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer">
                    <Linkedin className="h-4 w-4 mr-2" />
                    LinkedIn
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {onToggleVip && (
                <DropdownMenuItem onClick={() => onToggleVip(contact.id)}>
                  {contact.isVip ? (
                    <>
                      <StarOff className="h-4 w-4 mr-2" />
                      Remove VIP Status
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4 mr-2" />
                      Mark as VIP
                    </>
                  )}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-4 pt-4 border-t space-y-4"
        >
          {/* Health & Importance Bars */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Relationship Health</span>
                <span className={getHealthColor(contact.healthScore)}>
                  {contact.healthScore !== null && contact.healthScore !== undefined
                    ? `${Math.round(contact.healthScore * 100)}%`
                    : "N/A"
                  }
                </span>
              </div>
              <Progress
                value={(contact.healthScore ?? 0) * 100}
                className="h-2"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Importance</span>
                <span className="text-foreground">
                  {contact.importanceScore !== null && contact.importanceScore !== undefined
                    ? `${Math.round(contact.importanceScore * 100)}%`
                    : "N/A"
                  }
                </span>
              </div>
              <Progress
                value={(contact.importanceScore ?? 0) * 100}
                className="h-2"
              />
            </div>
          </div>

          {/* Communication Stats */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold text-foreground">
                {contact.totalThreads ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Threads</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-foreground">
                {contact.totalMessages ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Messages</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-foreground">
                {contact.avgResponseTimeHours !== null && contact.avgResponseTimeHours !== undefined
                  ? `${Math.round(contact.avgResponseTimeHours)}h`
                  : "N/A"
                }
              </div>
              <div className="text-xs text-muted-foreground">Avg Response</div>
            </div>
          </div>

          {/* Tags */}
          {contact.tags && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contact.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
