import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Shield, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  PresenceIndicator,
  type PresenceStatus,
} from "@/components/collaboration";
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOnlineUsers } from "@/hooks/use-presence";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/team/members")({
  component: MembersPage,
});

interface Member {
  id: string;
  role: string;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
}

function MembersPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [isPending, setIsPending] = useState(true);

  // Get online users for presence indicators
  const { data: onlineUsersData } = useOnlineUsers({
    organizationId: activeOrg?.id ?? "",
    enabled: Boolean(activeOrg?.id),
  });

  // Create a map of userId -> presence status for quick lookup
  const presenceMap = useMemo(() => {
    const map = new Map<string, PresenceStatus>();
    if (onlineUsersData?.users) {
      for (const user of onlineUsersData.users) {
        map.set(user.userId, (user.status as PresenceStatus) || "online");
      }
    }
    return map;
  }, [onlineUsersData?.users]);

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
        const result = await authClient.organization.listMembers({
          query: { organizationId: activeOrg.id },
        });
        if (result.data?.members) {
          setMembers(result.data.members as Member[]);
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
    const result = await authClient.organization.listMembers({
      query: { organizationId: activeOrg.id },
    });
    if (result.data?.members) {
      setMembers(result.data.members as Member[]);
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
                const initials = member.user?.name
                  ?.split(" ")
                  .map((n: string) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                // Get presence status for this member
                const presenceStatus =
                  presenceMap.get(member.user?.id) ?? "offline";

                return (
                  <div
                    className="flex items-center justify-between py-2"
                    key={member.id}
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Avatar>
                          <AvatarImage
                            alt={member.user?.name ?? "User"}
                            src={member.user?.image ?? undefined}
                          />
                          <AvatarFallback>{initials ?? "U"}</AvatarFallback>
                        </Avatar>
                        {/* Presence indicator positioned at bottom-right of avatar */}
                        <span className="absolute -right-0.5 -bottom-0.5">
                          <PresenceIndicator
                            size="sm"
                            status={presenceStatus}
                          />
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{member.user?.name}</p>
                          {presenceStatus === "online" && (
                            <span className="text-[10px] text-green-600">
                              Online
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {member.user?.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          member.role === "owner"
                            ? "default"
                            : member.role === "admin"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {member.role}
                      </Badge>
                      {member.role !== "owner" && (
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
                            {member.role !== "admin" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleUpdateRole(member.id, "admin")
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                            {member.role === "admin" && (
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
