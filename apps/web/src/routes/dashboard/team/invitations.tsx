import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@memorystack/ui-core/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useT } from "@/i18n";
import { type OrgInvite, orgAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/team/invitations")({
  component: InvitationsPage,
});

function InvitationsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const t = useT();
  const organizationId = user?.org_id ?? "";
  const isAdmin = user?.role === "pilot_owner" || user?.role === "pilot_admin";
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
    mutationFn: async (params: {
      email: string;
      role: "pilot_admin" | "pilot_member" | "pilot_viewer";
    }) => {
      await orgAPI.createInvite({ email: params.email, role: params.role });
    },
    onSuccess: () => {
      toast.success(t("pages.dashboard.team.invitationsPage.toasts.sent"));
      setEmail("");
      queryClient.invalidateQueries({
        queryKey: ["org-invites", organizationId],
      });
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
          t("pages.dashboard.team.invitationsPage.toasts.sendFailed")
      );
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (token: string) => {
      await orgAPI.revokeInvite(token);
    },
    onSuccess: () => {
      toast.success(t("pages.dashboard.team.invitationsPage.toasts.revoked"));
      queryClient.invalidateQueries({
        queryKey: ["org-invites", organizationId],
      });
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
          t("pages.dashboard.team.invitationsPage.toasts.revokeFailed")
      );
    },
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(organizationId && email && isAdmin)) {
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

  const invitationList = invitations ?? [];
  const pendingInvitations = useMemo(
    () =>
      invitationList.filter(
        (invite) => !invite.used_at && new Date(invite.expires_at) > new Date()
      ),
    [invitationList]
  );

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">
          {t("pages.dashboard.team.invitationsPage.notSignedIn")}
        </p>
      </div>
    );
  }

  const getStatus = (invite: OrgInvite) => {
    if (invite.used_at) return "accepted";
    if (new Date(invite.expires_at) <= new Date()) return "expired";
    return "pending";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          {t("nav.items.invitations")}
        </h1>
        <p className="text-muted-foreground">
          {t("pages.dashboard.team.invitationsPage.subtitle", {
            org: user.org_name,
          })}
        </p>
      </div>

      {/* Invite form */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("pages.dashboard.team.invitationsPage.form.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.team.invitationsPage.form.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex gap-4" onSubmit={handleInvite}>
            <div className="flex-1">
              <Label className="sr-only" htmlFor="email">
                {t("auth.email")}
              </Label>
              <Input
                disabled={!isAdmin}
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t(
                  "pages.dashboard.team.invitationsPage.form.emailPlaceholder"
                )}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="w-32">
              <Label className="sr-only" htmlFor="role">
                {t("pages.dashboard.team.invitationsPage.form.roleLabel")}
              </Label>
              <Select onValueChange={(val) => val && setRole(val)} value={role}>
                <SelectTrigger disabled={!isAdmin}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">
                    {t("pages.dashboard.team.roles.member")}
                  </SelectItem>
                  <SelectItem value="viewer">
                    {t("pages.dashboard.team.roles.viewer")}
                  </SelectItem>
                  <SelectItem value="admin">
                    {t("pages.dashboard.team.roles.admin")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!isAdmin || inviteMutation.isPending}
              type="submit"
            >
              <Mail className="mr-2 h-4 w-4" />
              {inviteMutation.isPending
                ? t("pages.dashboard.team.invitationsPage.form.sending")
                : t("pages.dashboard.team.invitationsPage.form.send")}
            </Button>
          </form>
          {isAdmin ? null : (
            <p className="mt-3 text-muted-foreground text-sm">
              {t("pages.dashboard.team.invitationsPage.form.adminRequired")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pending invitations */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("pages.dashboard.team.invitationsPage.pending.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.team.invitationsPage.pending.description")}
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
              {t("pages.dashboard.team.invitationsPage.pending.empty")}
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
                        {t(
                          "pages.dashboard.team.invitationsPage.pending.invitedOn",
                          {
                            date: new Date(
                              invitation.created_at ?? new Date()
                            ).toLocaleDateString(),
                          }
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {invitation.role === "pilot_admin"
                        ? t("pages.dashboard.team.roles.admin")
                        : invitation.role === "pilot_viewer"
                          ? t("pages.dashboard.team.roles.viewer")
                          : t("pages.dashboard.team.roles.member")}
                    </Badge>
                    <Badge variant="secondary">
                      {getStatus(invitation) === "accepted"
                        ? t(
                            "pages.dashboard.team.invitationsPage.status.accepted"
                          )
                        : getStatus(invitation) === "expired"
                          ? t(
                              "pages.dashboard.team.invitationsPage.status.expired"
                            )
                          : t(
                              "pages.dashboard.team.invitationsPage.status.pending"
                            )}
                    </Badge>
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
