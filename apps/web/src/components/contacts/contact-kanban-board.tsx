"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Clock,
  Mail,
  MoreHorizontal,
  Plus,
  Star,
  User,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

type KanbanColumn = "new" | "active" | "vip" | "at_risk" | "dormant";

interface KanbanContact {
  id: string;
  displayName: string;
  primaryEmail?: string | null;
  avatarUrl?: string | null;
  company?: string | null;
  title?: string | null;
  healthScore?: number | null;
  lastInteractionAt?: Date | null;
  isVip: boolean;
  isAtRisk: boolean;
  totalMessages?: number | null;
  sentimentScore?: number | null;
}

interface ColumnConfig {
  id: KanbanColumn;
  title: string;
  color: string;
  bgColor: string;
}

const columns: ColumnConfig[] = [
  { id: "new", title: "New", color: "text-blue-600", bgColor: "bg-blue-50 dark:bg-blue-950/30" },
  { id: "active", title: "Active", color: "text-green-600", bgColor: "bg-green-50 dark:bg-green-950/30" },
  { id: "vip", title: "VIP", color: "text-amber-600", bgColor: "bg-amber-50 dark:bg-amber-950/30" },
  { id: "at_risk", title: "At Risk", color: "text-red-600", bgColor: "bg-red-50 dark:bg-red-950/30" },
  { id: "dormant", title: "Dormant", color: "text-gray-500", bgColor: "bg-gray-50 dark:bg-gray-900/30" },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getColumnForContact(contact: KanbanContact): KanbanColumn {
  // VIP takes priority
  if (contact.isVip) return "vip";

  // At risk
  if (contact.isAtRisk || (contact.healthScore && contact.healthScore < 30)) {
    return "at_risk";
  }

  // Check for dormant (no interaction in 60+ days)
  if (contact.lastInteractionAt) {
    const daysSinceInteraction = Math.floor(
      (Date.now() - new Date(contact.lastInteractionAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceInteraction > 60) return "dormant";
  }

  // New contacts (less than 5 messages total)
  if (!contact.totalMessages || contact.totalMessages < 5) {
    return "new";
  }

  // Default to active
  return "active";
}

function getHealthColor(score: number | null | undefined): string {
  if (!score) return "bg-gray-200";
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

// =============================================================================
// CONTACT CARD COMPONENT
// =============================================================================

interface KanbanContactCardProps {
  contact: KanbanContact;
  onToggleVip: (contactId: string) => void;
  onViewProfile: (contactId: string) => void;
  onEmail: (email: string) => void;
}

function KanbanContactCard({
  contact,
  onToggleVip,
  onViewProfile,
  onEmail,
}: KanbanContactCardProps) {
  const initials = contact.displayName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "?";

  return (
    <Card className="mb-2 cursor-pointer border-border/50 transition-all hover:shadow-md">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-9 w-9">
            <AvatarImage src={contact.avatarUrl ?? undefined} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">
                {contact.displayName}
              </span>
              {contact.isVip && (
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              )}
              {contact.isAtRisk && (
                <AlertTriangle className="h-3 w-3 text-red-500" />
              )}
            </div>

            {contact.company && (
              <p className="truncate text-xs text-muted-foreground">
                {contact.title ? `${contact.title} at ` : ""}
                {contact.company}
              </p>
            )}

            {contact.lastInteractionAt && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(contact.lastInteractionAt), {
                  addSuffix: true,
                })}
              </p>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-6 w-6 shrink-0" size="icon" variant="ghost">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewProfile(contact.id)}>
                <User className="mr-2 h-4 w-4" />
                View Profile
              </DropdownMenuItem>
              {contact.primaryEmail && (
                <DropdownMenuItem
                  onClick={() => onEmail(contact.primaryEmail!)}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Send Email
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onToggleVip(contact.id)}>
                <Star className="mr-2 h-4 w-4" />
                {contact.isVip ? "Remove from VIP" : "Mark as VIP"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Health Score Bar */}
        {contact.healthScore !== null && contact.healthScore !== undefined && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">Health</span>
              <span className="font-medium">{contact.healthScore}%</span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full transition-all", getHealthColor(contact.healthScore))}
                style={{ width: `${contact.healthScore}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// KANBAN COLUMN COMPONENT
// =============================================================================

interface KanbanColumnProps {
  column: ColumnConfig;
  contacts: KanbanContact[];
  onToggleVip: (contactId: string) => void;
  onViewProfile: (contactId: string) => void;
  onEmail: (email: string) => void;
}

function KanbanColumn({
  column,
  contacts,
  onToggleVip,
  onViewProfile,
  onEmail,
}: KanbanColumnProps) {
  return (
    <div className="flex h-full w-[280px] flex-shrink-0 flex-col">
      <div className={cn("rounded-t-lg border-b px-3 py-2", column.bgColor)}>
        <div className="flex items-center justify-between">
          <h3 className={cn("text-sm font-semibold", column.color)}>
            {column.title}
          </h3>
          <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
            {contacts.length}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1 rounded-b-lg border border-t-0 bg-muted/20 p-2">
        {contacts.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
            No contacts
          </div>
        ) : (
          contacts.map((contact) => (
            <KanbanContactCard
              contact={contact}
              key={contact.id}
              onEmail={onEmail}
              onToggleVip={onToggleVip}
              onViewProfile={onViewProfile}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface ContactKanbanBoardProps {
  organizationId: string;
  onViewProfile: (contactId: string) => void;
}

export function ContactKanbanBoard({
  organizationId,
  onViewProfile,
}: ContactKanbanBoardProps) {
  // Fetch all contacts
  const { data: contactsData, refetch } = useQuery({
    ...trpc.contacts.list.queryOptions({
      organizationId,
      limit: 200,
    }),
    enabled: !!organizationId,
  });

  // Toggle VIP mutation
  const toggleVipMutation = useMutation({
    ...trpc.contacts.toggleVip.mutationOptions(),
    onSuccess: () => {
      toast.success("VIP status updated");
      refetch();
    },
  });

  const handleToggleVip = useCallback(
    (contactId: string) => {
      toggleVipMutation.mutate({ organizationId, contactId });
    },
    [toggleVipMutation, organizationId]
  );

  const handleEmail = useCallback((email: string) => {
    window.location.href = `mailto:${email}`;
  }, []);

  // Transform contacts to kanban format
  const contacts: KanbanContact[] = (contactsData?.contacts ?? []).map((c) => ({
    id: c.id,
    displayName: c.displayName,
    primaryEmail: c.primaryEmail,
    avatarUrl: c.avatarUrl,
    company: c.company,
    title: c.title,
    healthScore: c.healthScore,
    lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt) : null,
    isVip: c.isVip ?? false,
    isAtRisk: c.isAtRisk ?? false,
    totalMessages: c.totalMessages,
    sentimentScore: c.sentimentScore,
  }));

  // Group contacts by column
  const contactsByColumn = columns.reduce<Record<KanbanColumn, KanbanContact[]>>(
    (acc, col) => {
      acc[col.id] = contacts.filter((c) => getColumnForContact(c) === col.id);
      return acc;
    },
    { new: [], active: [], vip: [], at_risk: [], dormant: [] }
  );

  return (
    <div className="flex h-full gap-4 overflow-x-auto p-4">
      {columns.map((column) => (
        <KanbanColumn
          column={column}
          contacts={contactsByColumn[column.id]}
          key={column.id}
          onEmail={handleEmail}
          onToggleVip={handleToggleVip}
          onViewProfile={onViewProfile}
        />
      ))}
    </div>
  );
}
