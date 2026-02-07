import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, X } from "lucide-react";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useMemo, useState } from "react";
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
import { orgAPI, type OrgInvite } from "@/lib/api";

export const Route = createFileRoute("/dashboard/team/invitations")({
  component: InvitationsPage,
});

function InvitationsPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const {
    data: invitations,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["org-invites", organizationId],
    queryFn: () => orgAPI.listInvites(),
    enabled: !!organizationId,
  });

  const inviteMutation = useMutation({
    mutationFn: async (params: { email: string; role: "pilot_admin" | "pilot_member" | "pilot_viewer" }) => {
      await orgAPI.createInvite({ email: params.email, role: params.role });
    },
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["org-invites", organizationId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to send invitation");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (token: string) => {
      await orgAPI.revokeInvite(token);
    },
    onSuccess: () => {
      toast.success("Invitation revoked");
      queryClient.invalidateQueries({ queryKey: ["org-invites", organizationId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to revoke invitation");
    },
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationId || !email) {
      return;
    }

    inviteMutation.mutate({
      email,
      role:
        role === "admin"
          ? "pilot_admin"
          : role === "viewer"
            ? "pilot_viewer"
            : "pilot_member",
    });
  };

  const handleCancelInvitation = async (invitationId: string) => {
    revokeMutation.mutate(invitationId);
  };

  if (!activeOrg) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        {orgLoading ? (
          <p className="text-muted-foreground">Loading organization…</p>
        ) : (
          <p className="text-muted-foreground">No organization selected</p>
        )}
      </div>
    );
  }

  const invitationList = invitations ?? [];
  const pendingInvitations = useMemo(
    () =>
      invitationList.filter(
        (invite) => !invite.used_at && new Date(invite.expires_at) > new Date()
      ),
    [invitationList]
  );

  const getStatus = (invite: OrgInvite) => {
    if (invite.used_at) return "accepted";
    if (new Date(invite.expires_at) <= new Date()) return "expired";
    return "pending";
  };

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
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button disabled={inviteMutation.isPending} type="submit">
              <Mail className="mr-2 h-4 w-4" />
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
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
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div className="h-12 animate-pulse rounded bg-muted" key={i} />
              ))}
            </div>
          ) : isError ? (
            <ApiErrorPanel error={error} onRetry={() => refetch()} />
          ) : pendingInvitations.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No pending invitations
            </p>
          ) : (
            <div className="space-y-4">
              {pendingInvitations.map((invitation) => (
                <div
                  className="flex items-center justify-between py-2"
                  key={invitation.token}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{invitation.email ?? "—"}</p>
                      <p className="text-muted-foreground text-sm">
                        Invited{" "}
                        {new Date(invitation.created_at ?? new Date()).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {invitation.role.replace("pilot_", "")}
                    </Badge>
                    <Badge variant="secondary">{getStatus(invitation)}</Badge>
                    <Button
                      disabled={revokeMutation.isPending}
                      onClick={() => handleCancelInvitation(invitation.token)}
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
