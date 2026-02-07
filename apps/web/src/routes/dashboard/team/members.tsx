import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Shield, UserMinus } from "lucide-react";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useMemo } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { orgAPI, type OrgMember } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/team/members")({
  component: MembersPage,
});

function MembersPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const organizationId = user?.org_id ?? "";
  const isAdmin = user?.role === "pilot_owner" || user?.role === "pilot_admin";

  const {
    data: members,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: () => orgAPI.listMembers(),
    enabled: !!organizationId,
  });

  const updateRoleMutation = useMutation({
    mutationFn: async (params: { userId: string; role: "pilot_admin" | "pilot_member" | "pilot_viewer" }) => {
      await orgAPI.updateMemberRole({ userId: params.userId, role: params.role });
    },
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["org-members", organizationId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update role");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await orgAPI.removeMember(userId);
    },
    onSuccess: () => {
      toast.success("Member removed");
      queryClient.invalidateQueries({ queryKey: ["org-members", organizationId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to remove member");
    },
  });

  const isMutating = updateRoleMutation.isPending || removeMemberMutation.isPending;

  const memberList = useMemo(() => members ?? [], [members]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Sign in to manage your team.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Members</h1>
          <p className="text-muted-foreground">
            Manage members in {user.org_name}
          </p>
        </div>
        {isAdmin ? (
          <Link to="/dashboard/team/invitations">
            <Button>Invite members</Button>
          </Link>
        ) : (
          <Button disabled title="Admin access required">
            Invite members
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            {memberList.length} member{memberList.length !== 1 ? "s" : ""} in this
            organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div className="flex animate-pulse items-center gap-4" key={i}>
                  <div className="h-10 w-10 rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded bg-muted" />
                    <div className="h-3 w-48 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <ApiErrorPanel error={error} onRetry={() => refetch()} />
          ) : memberList.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No members found. Invite team members to get started.
            </p>
          ) : (
            <div className="space-y-4">
              {memberList.map((member) => {
                const displayName =
                  member.name ?? member.email?.split("@")[0] ?? "User";
                const displayInitials = displayName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                const isOwner =
                  member.role === "pilot_owner" || member.role === "owner";

                return (
                  <div
                    className="flex items-center justify-between py-2"
                    key={member.id}
                  >
                    <div className="flex items-center gap-4">
                      <Avatar>
                        <AvatarFallback>{displayInitials ?? "U"}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{displayName}</p>
                        <p className="text-muted-foreground text-sm">
                          {member.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          isOwner
                            ? "default"
                            : member.role === "pilot_admin"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {member.role.replace("pilot_", "")}
                      </Badge>
                      {isAdmin && !isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <Button
                              disabled={isMutating}
                              size="icon"
                              variant="ghost"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {member.role !== "pilot_admin" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateRoleMutation.mutate({
                                    userId: member.id,
                                    role: "pilot_admin",
                                  })
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                            {member.role !== "pilot_member" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateRoleMutation.mutate({
                                    userId: member.id,
                                    role: "pilot_member",
                                  })
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Make Member
                              </DropdownMenuItem>
                            )}
                            {member.role !== "pilot_viewer" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateRoleMutation.mutate({
                                    userId: member.id,
                                    role: "pilot_viewer",
                                  })
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Make Viewer
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => removeMemberMutation.mutate(member.id)}
                            >
                              <UserMinus className="mr-2 h-4 w-4" />
                              Remove Member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
