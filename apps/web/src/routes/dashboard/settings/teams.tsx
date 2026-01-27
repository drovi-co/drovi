// =============================================================================
// TEAMS MANAGEMENT PAGE
// =============================================================================
//
// Manage sub-teams within the organization for collaboration:
// - Create/edit/delete teams
// - Assign members to teams
// - Set team permissions
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  MoreHorizontal,
  Plus,
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
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/settings/teams")({
  component: TeamsManagementPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function TeamsManagementPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");

  // Fetch teams
  const { data: teamsData, isLoading } = useQuery({
    ...trpc.organizations.getTeams.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Create team mutation (using Better Auth organization teams API)
  const handleCreateTeam = async () => {
    if (!activeOrg || !newTeamName.trim()) return;

    try {
      await authClient.organization.createTeam({
        organizationId: activeOrg.id,
        data: {
          name: newTeamName.trim(),
        },
      });
      toast.success("Team created successfully");
      setCreateDialogOpen(false);
      setNewTeamName("");
      setNewTeamDescription("");
      queryClient.invalidateQueries({ queryKey: ["organizations", "getTeams"] });
    } catch (error) {
      console.error("Failed to create team:", error);
      toast.error("Failed to create team");
    }
  };

  // Delete team
  const handleDeleteTeam = async (teamId: string) => {
    if (!activeOrg) return;

    try {
      await authClient.organization.deleteTeam({
        organizationId: activeOrg.id,
        teamId,
      });
      toast.success("Team deleted");
      queryClient.invalidateQueries({ queryKey: ["organizations", "getTeams"] });
    } catch (error) {
      console.error("Failed to delete team:", error);
      toast.error("Failed to delete team");
    }
  };

  const teams = teamsData?.teams ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Teams</h1>
          <p className="text-muted-foreground">
            Organize your organization into teams for better collaboration
          </p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Team
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Team</DialogTitle>
              <DialogDescription>
                Create a team to organize members and manage permissions together
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Team Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Engineering, Sales, Support"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="What does this team do?"
                  value={newTeamDescription}
                  onChange={(e) => setNewTeamDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTeam}
                disabled={!newTeamName.trim()}
              >
                Create Team
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-32 rounded bg-muted" />
                <div className="h-4 w-48 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-24 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 font-semibold text-lg">No teams yet</h3>
            <p className="mb-4 text-center text-muted-foreground">
              Create teams to organize your members and manage access together
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Team
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Card key={team.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {team.name}
                  </CardTitle>
                  {team.description && (
                    <CardDescription className="mt-1">
                      {team.description}
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-500"
                      onClick={() => handleDeleteTeam(team.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Team
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    0 members
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    Created {new Date(team.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
