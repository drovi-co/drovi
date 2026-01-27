"use client";

/**
 * DelegationDialog
 *
 * Modal dialog for delegating/assigning conversations to teammates.
 * Supports:
 * - Selecting a team member to delegate to
 * - Adding optional notes
 * - Setting delegation type (inbox triage, full access, etc.)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, Loader2, Search, User, UserPlus, Users, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PresenceIndicator, type PresenceStatus } from "./presence-indicator";
import { useOnlineUsers } from "@/hooks/use-presence";
import { useTRPC } from "@/utils/trpc";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export type DelegationType = "inbox_triage" | "commitment_management" | "full_access";

interface DelegationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** For shared inbox assignment, provide sharedInboxId and assignmentId */
  sharedInboxId?: string;
  assignmentId?: string;
  conversationTitle?: string;
  currentAssigneeId?: string | null;
  onSuccess?: (delegateeId: string) => void;
}

// Member type inferred from API response
type TeamMember = {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
};

// =============================================================================
// Component
// =============================================================================

export function DelegationDialog({
  open,
  onOpenChange,
  organizationId,
  sharedInboxId,
  assignmentId,
  conversationTitle,
  currentAssigneeId,
  onSuccess,
}: DelegationDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [delegationType, setDelegationType] = useState<DelegationType>("inbox_triage");
  const [note, setNote] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch organization members for assignment
  const { data: membersData, isLoading: isLoadingMembers } = useQuery({
    ...trpc.organizations.getMembers.queryOptions({
      organizationId,
    }),
    enabled: open && Boolean(organizationId),
  });

  // Get online users for presence indicators
  const { data: onlineUsersData } = useOnlineUsers({
    organizationId,
    enabled: open && Boolean(organizationId),
  });

  // Create presence map
  const presenceMap = new Map<string, PresenceStatus>();
  if (onlineUsersData?.users) {
    for (const user of onlineUsersData.users) {
      presenceMap.set(user.userId, (user.status as PresenceStatus) || "online");
    }
  }

  // Assign mutation (for shared inbox assignment)
  const assignMutation = useMutation(
    trpc.sharedInbox.assign.mutationOptions({
      onSuccess: () => {
        toast.success("Conversation assigned");
        queryClient.invalidateQueries({ queryKey: ["sharedInbox"] });
        queryClient.invalidateQueries({ queryKey: ["unifiedInbox"] });
        onOpenChange(false);
        if (selectedUserId) {
          onSuccess?.(selectedUserId);
        }
        // Reset form
        setSelectedUserId(null);
        setNote("");
      },
      onError: (error) => {
        toast.error("Failed to assign conversation", {
          description: error.message,
        });
      },
    })
  );

  // Filter members based on search
  const filteredMembers = (membersData?.members ?? []).filter((member) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      member.user?.name?.toLowerCase().includes(query) ||
      member.user?.email.toLowerCase().includes(query)
    );
  });

  const handleAssign = useCallback(() => {
    if (!selectedUserId || !sharedInboxId || !assignmentId) return;

    assignMutation.mutate({
      organizationId,
      sharedInboxId,
      assignmentId,
      assignToUserId: selectedUserId,
      note: note || undefined,
    });
  }, [selectedUserId, sharedInboxId, assignmentId, organizationId, note, assignMutation]);

  const selectedMember = filteredMembers.find(
    (m) => m.user?.id === selectedUserId
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Assign Conversation
          </DialogTitle>
          <DialogDescription>
            {conversationTitle ? (
              <>Assign "{conversationTitle}" to a team member</>
            ) : (
              <>Select a team member to handle this conversation</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search team members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Team members list */}
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
            {isLoadingMembers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {searchQuery ? "No members match your search" : "No team members found"}
              </div>
            ) : (
              filteredMembers
                .filter((member) => member.user !== null)
                .map((member) => {
                  const user = member.user!;
                  const isSelected = selectedUserId === user.id;
                  const isCurrentAssignee = currentAssigneeId === user.id;
                  const presenceStatus = presenceMap.get(user.id) ?? "offline";
                  const initials = user.name
                    ?.split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2) ?? "?";

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedUserId(user.id)}
                      disabled={isCurrentAssignee}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors",
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary"
                          : "hover:bg-muted",
                        isCurrentAssignee && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <div className="relative">
                        <Avatar className="h-8 w-8">
                          <AvatarImage
                            src={user.image ?? undefined}
                            alt={user.name ?? undefined}
                          />
                          <AvatarFallback className="text-xs">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5">
                          <PresenceIndicator status={presenceStatus} size="sm" />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {user.name ?? "Unknown"}
                          </span>
                          {presenceStatus === "online" && (
                            <span className="text-[10px] text-green-600">Online</span>
                          )}
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCurrentAssignee && (
                          <Badge variant="secondary" className="text-[10px]">
                            Current
                          </Badge>
                        )}
                        {isSelected && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </button>
                  );
                })
            )}
          </div>

          {/* Note input */}
          {selectedUserId && (
            <div className="space-y-2">
              <Label htmlFor="delegation-note">Add a note (optional)</Label>
              <Textarea
                id="delegation-note"
                placeholder="Any context or instructions for the assignee..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedUserId || !sharedInboxId || !assignmentId || assignMutation.isPending}
          >
            {assignMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Assigning...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Assign to {selectedMember?.user?.name?.split(" ")[0] ?? "member"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Quick Assign Button (for shared inbox assignments)
// =============================================================================

interface QuickAssignButtonProps {
  organizationId: string;
  sharedInboxId: string;
  assignmentId: string;
  conversationTitle?: string;
  currentAssigneeId?: string | null;
  currentAssigneeName?: string | null;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  onAssigned?: (assigneeId: string) => void;
}

export function QuickAssignButton({
  organizationId,
  sharedInboxId,
  assignmentId,
  conversationTitle,
  currentAssigneeId,
  currentAssigneeName,
  variant = "outline",
  size = "sm",
  className,
  onAssigned,
}: QuickAssignButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={cn("gap-2", className)}
        onClick={() => setDialogOpen(true)}
      >
        {currentAssigneeId ? (
          <>
            <User className="h-4 w-4" />
            <span className="truncate max-w-[100px]">
              {currentAssigneeName ?? "Assigned"}
            </span>
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4" />
            Assign
          </>
        )}
      </Button>

      <DelegationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        sharedInboxId={sharedInboxId}
        assignmentId={assignmentId}
        conversationTitle={conversationTitle}
        currentAssigneeId={currentAssigneeId}
        onSuccess={onAssigned}
      />
    </>
  );
}
