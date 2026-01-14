import { createFileRoute } from "@tanstack/react-router";
import { User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AccountDeletion } from "@/components/settings/account-deletion";
import { AISettings } from "@/components/settings/ai-settings";
import { ApiKeys } from "@/components/settings/api-keys";
import { DataExport } from "@/components/settings/data-export";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { SessionManagement } from "@/components/settings/session-management";
import { TwoFactorSettings } from "@/components/settings/two-factor-settings";
import { Webhooks } from "@/components/settings/webhooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImageUpload } from "@/components/ui/image-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const { data: sessionData, refetch } = authClient.useSession();
  const user = sessionData?.user ?? session.data?.user;

  const [name, setName] = useState(user?.name ?? "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const handleUpdateProfile = async () => {
    setIsUpdating(true);
    try {
      await authClient.updateUser({ name });
      toast.success("Profile updated successfully");
      refetch();
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAvatarChange = async (imageUrl: string | null) => {
    setIsUploadingAvatar(true);
    try {
      await authClient.updateUser({ image: imageUrl ?? undefined });
      toast.success(
        imageUrl ? "Avatar updated successfully" : "Avatar removed"
      );
      refetch();
    } catch {
      toast.error("Failed to update avatar");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleRefreshSession = () => {
    refetch();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="grid gap-6">
        {/* Profile settings */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar */}
            <div className="space-y-2">
              <Label>Profile Picture</Label>
              <ImageUpload
                disabled={isUploadingAvatar}
                maxSizeKB={500}
                onChange={handleAvatarChange}
                placeholder={<User className="h-6 w-6 text-muted-foreground" />}
                value={user?.image}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                value={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                className="bg-muted"
                disabled
                id="email"
                value={user?.email ?? ""}
              />
              <p className="text-muted-foreground text-xs">
                {user?.emailVerified
                  ? "Email verified"
                  : "Email not verified - check your inbox"}
              </p>
            </div>
            <Button disabled={isUpdating} onClick={handleUpdateProfile}>
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </CardContent>
        </Card>

        <Separator />

        {/* AI Settings */}
        <AISettings />

        <Separator />

        {/* Notification Settings */}
        <NotificationSettings />

        <Separator />

        {/* Two-Factor Authentication */}
        <TwoFactorSettings
          onUpdate={handleRefreshSession}
          twoFactorEnabled={user?.twoFactorEnabled ?? false}
        />

        <Separator />

        {/* Password change */}
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Change your account password</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline">Change Password</Button>
          </CardContent>
        </Card>

        <Separator />

        {/* Session Management */}
        <SessionManagement />

        <Separator />

        {/* API Keys */}
        <ApiKeys />

        <Separator />

        {/* Webhooks */}
        <Webhooks />

        <Separator />

        {/* Data Export (GDPR) */}
        <DataExport />

        <Separator />

        {/* Danger zone - Account Deletion */}
        <AccountDeletion userEmail={user?.email ?? ""} />
      </div>
    </div>
  );
}
