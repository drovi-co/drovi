// =============================================================================
// SHARED INBOX CONFIGURATION PAGE
// =============================================================================
//
// Configure shared inboxes for team collaboration:
// - Create shared inboxes
// - Configure round-robin assignment
// - Set SLA tracking
// - Manage inbox members
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Clock,
  Inbox,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/settings/shared-inbox")({
  component: SharedInboxConfigPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SharedInboxConfigPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newInboxName, setNewInboxName] = useState("");
  const [newInboxDescription, setNewInboxDescription] = useState("");
  const [assignmentMode, setAssignmentMode] = useState<
    "round_robin" | "least_busy" | "manual"
  >("round_robin");
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(true);
  const [firstResponseSla, setFirstResponseSla] = useState("");
  const [resolutionSla, setResolutionSla] = useState("");

  // Fetch shared inboxes
  const { data: inboxesData, isLoading } = useQuery({
    ...trpc.sharedInbox.list.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Create inbox mutation
  const createMutation = useMutation(
    trpc.sharedInbox.create.mutationOptions({
      onSuccess: () => {
        toast.success("Shared inbox created");
        setCreateDialogOpen(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: ["sharedInbox", "list"] });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to create shared inbox");
      },
    })
  );

  // Delete inbox mutation
  const deleteMutation = useMutation(
    trpc.sharedInbox.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Shared inbox deleted");
        queryClient.invalidateQueries({ queryKey: ["sharedInbox", "list"] });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete shared inbox");
      },
    })
  );

  const resetForm = () => {
    setNewInboxName("");
    setNewInboxDescription("");
    setAssignmentMode("round_robin");
    setAutoAssignEnabled(true);
    setFirstResponseSla("");
    setResolutionSla("");
  };

  const handleCreateInbox = () => {
    if (!newInboxName.trim()) return;

    createMutation.mutate({
      organizationId,
      name: newInboxName.trim(),
      description: newInboxDescription.trim() || undefined,
      assignmentMode,
      autoAssignEnabled,
      firstResponseSlaMinutes: firstResponseSla
        ? Number.parseInt(firstResponseSla)
        : undefined,
      resolutionSlaMinutes: resolutionSla
        ? Number.parseInt(resolutionSla)
        : undefined,
    });
  };

  const handleDeleteInbox = (inboxId: string) => {
    deleteMutation.mutate({ organizationId, inboxId });
  };

  const inboxes = inboxesData?.inboxes ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Shared Inboxes</h1>
          <p className="text-muted-foreground">
            Create shared inboxes for team collaboration with automatic
            assignment
          </p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Inbox
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Shared Inbox</DialogTitle>
              <DialogDescription>
                Set up a shared inbox for your team with automatic assignment
                and SLA tracking
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="inboxName">Inbox Name</Label>
                <Input
                  id="inboxName"
                  placeholder="e.g., Support, Sales, Help Desk"
                  value={newInboxName}
                  onChange={(e) => setNewInboxName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inboxDescription">Description (optional)</Label>
                <Textarea
                  id="inboxDescription"
                  placeholder="What is this inbox for?"
                  value={newInboxDescription}
                  onChange={(e) => setNewInboxDescription(e.target.value)}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Assignment Mode</Label>
                <Select
                  value={assignmentMode}
                  onValueChange={(v) =>
                    setAssignmentMode(v as typeof assignmentMode)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round_robin">
                      Round Robin - Equal distribution
                    </SelectItem>
                    <SelectItem value="least_busy">
                      Least Busy - Assign to member with fewest active items
                    </SelectItem>
                    <SelectItem value="manual">
                      Manual - Members claim conversations
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-assign new conversations</Label>
                  <p className="text-muted-foreground text-sm">
                    Automatically assign conversations when they arrive
                  </p>
                </div>
                <Switch
                  checked={autoAssignEnabled}
                  onCheckedChange={setAutoAssignEnabled}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>SLA Settings</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="firstResponseSla"
                      className="text-muted-foreground text-xs"
                    >
                      First Response (minutes)
                    </Label>
                    <Input
                      id="firstResponseSla"
                      type="number"
                      placeholder="e.g., 30"
                      value={firstResponseSla}
                      onChange={(e) => setFirstResponseSla(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="resolutionSla"
                      className="text-muted-foreground text-xs"
                    >
                      Resolution (minutes)
                    </Label>
                    <Input
                      id="resolutionSla"
                      type="number"
                      placeholder="e.g., 1440"
                      value={resolutionSla}
                      onChange={(e) => setResolutionSla(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  Leave empty to disable SLA tracking
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCreateDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateInbox}
                disabled={!newInboxName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Inbox"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-32 rounded bg-muted" />
                <div className="h-4 w-48 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-4 w-32 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : inboxes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Inbox className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 font-semibold text-lg">No shared inboxes</h3>
            <p className="mb-4 text-center text-muted-foreground">
              Create a shared inbox to let your team collaborate on
              conversations together
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Inbox
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {inboxes.map((inbox) => (
            <Card key={inbox.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Inbox className="h-4 w-4" />
                    {inbox.name}
                  </CardTitle>
                  {inbox.description && (
                    <CardDescription className="mt-1">
                      {inbox.description}
                    </CardDescription>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add Members
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-500"
                      onClick={() => handleDeleteInbox(inbox.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Inbox
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {inbox.assignmentMode === "round_robin"
                      ? "Round Robin"
                      : inbox.assignmentMode === "least_busy"
                        ? "Least Busy"
                        : "Manual"}
                  </Badge>
                  {inbox.autoAssignEnabled && (
                    <Badge variant="secondary">Auto-assign</Badge>
                  )}
                  {inbox.isActive && (
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/30">
                      Active
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-4 text-muted-foreground text-sm">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{inbox.memberCount ?? 0} members</span>
                  </div>
                  {inbox.firstResponseSlaMinutes && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>SLA: {inbox.firstResponseSlaMinutes}m</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
