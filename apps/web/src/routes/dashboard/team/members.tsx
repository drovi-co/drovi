import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Shield, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
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
import { authClient } from "@/lib/auth-client";
import type { OrgMember } from "@/lib/api";

export const Route = createFileRoute("/dashboard/team/members")({
  component: MembersPage,
});

function MembersPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isPending, setIsPending] = useState(true);

  // Fetch members when org changes
  useEffect(() => {
    const fetchMembers = async () => {
      if (!activeOrg) {
        setMembers([]);
        setIsPending(false);
        return;
      }

      setIsPending(true);
      try {
        const result = await authClient.organization.listMembers();
        if (result.data?.members) {
          setMembers(result.data.members as OrgMember[]);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to fetch members:", error);
        }
        toast.error("Failed to load team members");
      } finally {
        setIsPending(false);
      }
    };

    fetchMembers();
  }, [activeOrg?.id]);

  const refetch = async () => {
    if (!activeOrg) {
      return;
    }
    const result = await authClient.organization.listMembers();
    if (result.data?.members) {
      setMembers(result.data.members as OrgMember[]);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!activeOrg) {
      return;
    }
    setIsLoading(true);
    try {
      await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: activeOrg.id,
      });
      refetch();
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    if (!activeOrg) {
      return;
    }
    setIsLoading(true);
    try {
      await authClient.organization.updateMemberRole({
        memberId,
        role: newRole as "admin" | "member",
        organizationId: activeOrg.id,
      });
      refetch();
    } finally {
      setIsLoading(false);
    }
  };

  if (!activeOrg) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">No organization selected</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Members</h1>
          <p className="text-muted-foreground">
            Manage members in {activeOrg.name}
          </p>
        </div>
        <Link to="/dashboard/team/invitations">
          <Button>Invite Members</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            {members.length} member{members.length !== 1 ? "s" : ""} in this
            organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
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
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No members found. Invite team members to get started.
            </p>
          ) : (
            <div className="space-y-4">
              {members.map((member) => {
                const displayName =
                  member.name ?? member.email?.split("@")[0] ?? "User";
                const displayInitials = displayName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

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
                          member.role === "pilot_owner"
                            ? "default"
                            : member.role === "pilot_admin"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {member.role.replace("pilot_", "")}
                      </Badge>
                      {member.role !== "pilot_owner" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <Button
                              disabled={isLoading}
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
                                  handleUpdateRole(member.id, "admin")
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                            {member.role === "pilot_admin" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleUpdateRole(member.id, "member")
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Remove Admin
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleRemoveMember(member.id)}
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
