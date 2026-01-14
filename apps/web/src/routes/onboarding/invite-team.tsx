import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Crown, Loader2, Mail, Plus, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
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
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding/invite-team")({
  component: InviteTeamPage,
});

interface PendingInvite {
  email: string;
  role: "admin" | "member";
}

function InviteTeamPage() {
  const navigate = useNavigate();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const [email, setEmail] = useState("");
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [isInviting, setIsInviting] = useState(false);

  const handleAddInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      return;
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    // Check for duplicates
    if (
      invites.some((inv) => inv.email.toLowerCase() === email.toLowerCase())
    ) {
      toast.error("This email has already been added");
      return;
    }

    setInvites([...invites, { email, role: "member" }]);
    setEmail("");
  };

  const handleRemoveInvite = (emailToRemove: string) => {
    setInvites(invites.filter((inv) => inv.email !== emailToRemove));
  };

  const handleToggleRole = (emailToToggle: string) => {
    setInvites(
      invites.map((inv) =>
        inv.email === emailToToggle
          ? { ...inv, role: inv.role === "admin" ? "member" : "admin" }
          : inv
      )
    );
  };

  const handleSendInvites = async () => {
    if (!activeOrg || invites.length === 0) {
      return;
    }

    setIsInviting(true);

    try {
      await Promise.all(
        invites.map((invite) =>
          authClient.organization.inviteMember({
            email: invite.email,
            role: invite.role,
            organizationId: activeOrg.id,
          })
        )
      );

      toast.success(
        `${invites.length} invitation${invites.length > 1 ? "s" : ""} sent!`
      );
      navigate({ to: "/onboarding/complete" });
    } catch {
      toast.error("Failed to send some invitations. Please try again.");
    } finally {
      setIsInviting(false);
    }
  };

  const handleSkip = () => {
    navigate({ to: "/onboarding/complete" });
  };

  if (!activeOrg) {
    return (
      <OnboardingLayout step={3}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout step={3}>
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="pb-2 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">Invite Your Team</CardTitle>
          <CardDescription className="text-base">
            Add team members to{" "}
            <span className="font-medium">{activeOrg.name}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          {/* Add invite form */}
          <form className="flex gap-2" onSubmit={handleAddInvite}>
            <div className="relative flex-1">
              <Mail className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 pl-10"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                type="email"
                value={email}
              />
            </div>
            <Button className="h-11 w-11 shrink-0" size="icon" type="submit">
              <Plus className="h-4 w-4" />
            </Button>
          </form>

          {/* Pending invites list */}
          {invites.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Pending Invites</Label>
                <span className="text-muted-foreground text-xs">
                  {invites.length} member{invites.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {invites.map((invite) => (
                  <div
                    className="group flex items-center justify-between rounded-lg border bg-muted/30 p-3"
                    key={invite.email}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs">
                        {invite.email.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate text-sm">{invite.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className="cursor-pointer gap-1 transition-colors"
                        onClick={() => handleToggleRole(invite.email)}
                        variant={
                          invite.role === "admin" ? "default" : "secondary"
                        }
                      >
                        {invite.role === "admin" && (
                          <Crown className="h-3 w-3" />
                        )}
                        {invite.role}
                      </Badge>
                      <Button
                        className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => handleRemoveInvite(invite.email)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Click the role badge to toggle between admin and member
              </p>
            </div>
          )}

          {/* Empty state */}
          {invites.length === 0 && (
            <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
              <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">
                Add email addresses above to invite your team members
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <Button
              className="h-11 w-full"
              disabled={invites.length === 0 || isInviting}
              onClick={handleSendInvites}
            >
              {isInviting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending invites...
                </>
              ) : (
                `Send ${invites.length || ""} Invite${invites.length !== 1 ? "s" : ""}`
              )}
            </Button>
            <Button
              className="w-full"
              onClick={handleSkip}
              type="button"
              variant="ghost"
            >
              Skip for now
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-muted-foreground text-sm">
        You can always invite more team members from your dashboard
      </p>
    </OnboardingLayout>
  );
}
