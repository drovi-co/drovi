import { createFileRoute } from "@tanstack/react-router";
import { Mail, X } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/team/invitations")({
  component: InvitationsPage,
});

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date | string;
}

function InvitationsPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isPending, setIsPending] = useState(true);

  // Fetch invitations when org changes
  useEffect(() => {
    const fetchInvitations = async () => {
      if (!activeOrg) {
        setInvitations([]);
        setIsPending(false);
        return;
      }

      setIsPending(true);
      try {
        const result = await authClient.organization.listInvitations({
          query: { organizationId: activeOrg.id },
        });
        if (result.data) {
          setInvitations(result.data as unknown as Invitation[]);
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error("Failed to fetch invitations:", error);
        }
        toast.error("Failed to load invitations");
      } finally {
        setIsPending(false);
      }
    };

    fetchInvitations();
  }, [activeOrg?.id]);

  const refetch = async () => {
    if (!activeOrg) {
      return;
    }
    const result = await authClient.organization.listInvitations({
      query: { organizationId: activeOrg.id },
    });
    if (result.data) {
      setInvitations(result.data as unknown as Invitation[]);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(activeOrg && email)) {
      return;
    }

    setIsInviting(true);
    try {
      await authClient.organization.inviteMember({
        email,
        role: role as "admin" | "member",
        organizationId: activeOrg.id,
      });
      setEmail("");
      refetch();
    } finally {
      setIsInviting(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    await authClient.organization.cancelInvitation({ invitationId });
    refetch();
  };

  if (!activeOrg) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">No organization selected</p>
      </div>
    );
  }

  const pendingInvitations = invitations.filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Invitations</h1>
        <p className="text-muted-foreground">
          Invite new members to {activeOrg.name}
        </p>
      </div>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle>Invite a Member</CardTitle>
          <CardDescription>
            Send an invitation email to add someone to your team
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex gap-4" onSubmit={handleInvite}>
            <div className="flex-1">
              <Label className="sr-only" htmlFor="email">
                Email
              </Label>
              <Input
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                required
                type="email"
                value={email}
              />
            </div>
            <div className="w-32">
              <Label className="sr-only" htmlFor="role">
                Role
              </Label>
              <Select onValueChange={(val) => val && setRole(val)} value={role}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button disabled={isInviting} type="submit">
              <Mail className="mr-2 h-4 w-4" />
              {isInviting ? "Sending..." : "Send Invite"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Pending invitations */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>
            Invitations that haven't been accepted yet
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div className="h-12 animate-pulse rounded bg-muted" key={i} />
              ))}
            </div>
          ) : pendingInvitations.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No pending invitations
            </p>
          ) : (
            <div className="space-y-4">
              {pendingInvitations.map((invitation) => (
                <div
                  className="flex items-center justify-between py-2"
                  key={invitation.id}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-muted-foreground text-sm">
                        Invited{" "}
                        {new Date(invitation.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{invitation.role}</Badge>
                    <Badge variant="secondary">{invitation.status}</Badge>
                    <Button
                      onClick={() => handleCancelInvitation(invitation.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
