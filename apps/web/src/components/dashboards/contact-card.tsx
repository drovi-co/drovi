// =============================================================================
// CONTACT CARD COMPONENT
// =============================================================================
//
// Intelligence-first contact display showing relationship health, importance,
// open loops, and interaction history. This isn't a contact card - it's a
// relationship intelligence surface.
//

import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";
import {
  Calendar,
  Heart,
  Linkedin,
  Mail,
  MoreHorizontal,
  Phone,
  Sparkles,
  Star,
  StarOff,
  TrendingDown,
  User,
} from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getSourceConfig, getSourceColor, type SourceType } from "@/lib/source-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  // Multi-source support - which sources this contact appears in
  sources?: SourceType[];
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

function formatLastInteraction(date: Date): string {
  if (isToday(date)) {
    return format(date, "h:mm a");
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  return format(date, "MMM d");
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
}: ContactCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const displayName = contact.displayName ?? contact.primaryEmail.split("@")[0];

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors",
        "border-b border-border/40",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      {/* Priority indicator bar */}
      {contact.isAtRisk && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
      )}
      {contact.isVip && !contact.isAtRisk && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
      )}

      {/* Avatar */}
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={contact.avatarUrl ?? undefined} alt={displayName} />
        <AvatarFallback className="text-xs bg-muted font-medium">
          {getInitials(contact.displayName, contact.primaryEmail)}
        </AvatarFallback>
      </Avatar>

      {/* Name with source indicators */}
      <div className="w-40 shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium text-foreground/80 truncate">
            {displayName}
          </span>
          {contact.isVip && (
            <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
          )}
        </div>
        {/* Source badges */}
        {contact.sources && contact.sources.length > 0 && (
          <div className="flex items-center gap-0.5 mt-0.5">
            {contact.sources.slice(0, 4).map((sourceType) => {
              const config = getSourceConfig(sourceType);
              const color = getSourceColor(sourceType);
              const SourceIcon = config.icon;
              return (
                <div
                  key={sourceType}
                  className="flex h-4 w-4 items-center justify-center rounded"
                  style={{ backgroundColor: `${color}15` }}
                  title={config.label}
                >
                  <SourceIcon className="h-2.5 w-2.5" style={{ color }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Title & Company */}
      <div className="w-48 shrink-0 truncate text-sm text-muted-foreground">
        {contact.title || contact.company ? (
          <>
            {contact.title}
            {contact.title && contact.company && " at "}
            {contact.company}
          </>
        ) : (
          <span className="opacity-50">-</span>
        )}
      </div>

      {/* Email with AI indicator */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {(contact.healthScore !== null || contact.importanceScore !== null) && (
          <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEmailClick?.(contact.primaryEmail);
          }}
          className="text-sm text-muted-foreground hover:text-foreground truncate text-left"
        >
          {contact.primaryEmail}
        </button>
      </div>

      {/* Health Score as colored pill */}
      {contact.healthScore !== null && contact.healthScore !== undefined && !isHovered && (
        <span className={cn(
          "flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0",
          contact.healthScore >= 0.7 && "bg-green-500/10 text-green-600 dark:text-green-400",
          contact.healthScore >= 0.4 && contact.healthScore < 0.7 && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          contact.healthScore < 0.4 && "bg-red-500/10 text-red-600 dark:text-red-400"
        )}>
          <Heart className="h-3 w-3" />
          {Math.round(contact.healthScore * 100)}%
        </span>
      )}

      {/* At-Risk Badge */}
      {contact.isAtRisk && !isHovered && (
        <Badge variant="destructive" className="text-[10px] shrink-0">
          <TrendingDown className="h-3 w-3 mr-1" />
          At Risk
        </Badge>
      )}

      {/* Last Interaction */}
      {contact.lastInteractionAt && !isHovered && (
        <span className="text-xs text-muted-foreground font-medium shrink-0 w-24 text-right whitespace-nowrap">
          {formatLastInteraction(contact.lastInteractionAt)}
        </span>
      )}

      {/* Quick actions (on hover) */}
      <div className="w-24 shrink-0 flex items-center justify-end gap-1">
        {isHovered ? (
          <>
            {onToggleVip && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVip(contact.id);
                }}
                className="p-1.5 rounded-md hover:bg-background transition-colors"
              >
                {contact.isVip ? (
                  <StarOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Star className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEmailClick?.(contact.primaryEmail);
              }}
              className="p-1.5 rounded-md hover:bg-background transition-colors"
            >
              <Mail className="h-4 w-4 text-muted-foreground" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-md hover:bg-background transition-colors"
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
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
          </>
        ) : null}
      </div>
    </div>
  );
}
