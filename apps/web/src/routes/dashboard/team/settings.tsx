import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/team/settings")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const navigate = useNavigate();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  // Initialize form values when org loads
  useEffect(() => {
    if (activeOrg) {
      setName(activeOrg.name);
      setSlug(activeOrg.slug);
    }
  }, [activeOrg?.id]);

  const handleUpdateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) {
      return;
    }

    setIsUpdating(true);
    try {
      await authClient.organization.update({
        organizationId: activeOrg.id,
        data: {
          name,
          slug,
        },
      });
      toast.success("Organization updated successfully");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Update error:", error);
      }
      toast.error("Failed to update organization");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogoChange = async (logoUrl: string | null) => {
    if (!activeOrg) {
      return;
    }

    setIsUploadingLogo(true);
    try {
      await authClient.organization.update({
        organizationId: activeOrg.id,
        data: {
          logo: logoUrl ?? undefined,
        },
      });
      toast.success(logoUrl ? "Logo updated successfully" : "Logo removed");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Logo update error:", error);
      }
      toast.error("Failed to update logo");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleDeleteOrg = async () => {
    if (!activeOrg) {
      return;
    }

    setIsDeleting(true);
    try {
      await authClient.organization.delete({
        organizationId: activeOrg.id,
      });
      navigate({ to: "/onboarding/create-org" });
    } finally {
      setIsDeleting(false);
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
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          Organization Settings
        </h1>
        <p className="text-muted-foreground">
          Manage settings for {activeOrg.name}
        </p>
      </div>

      {/* General settings */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Update your organization's basic information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleUpdateOrg}>
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                onChange={(e) => setName(e.target.value)}
                placeholder="My Organization"
                value={name || activeOrg.name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Organization Slug</Label>
              <Input
                id="slug"
                onChange={(e) => setSlug(e.target.value)}
                placeholder="my-organization"
                value={slug || activeOrg.slug}
              />
              <p className="text-muted-foreground text-sm">
                This is used in URLs and must be unique
              </p>
            </div>
            <Button disabled={isUpdating} type="submit">
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Logo upload */}
      <Card>
        <CardHeader>
          <CardTitle>Organization Logo</CardTitle>
          <CardDescription>
            Upload a logo for your organization. Recommended size: 256x256px
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImageUpload
            disabled={isUploadingLogo}
            maxSizeKB={500}
            onChange={handleLogoChange}
            placeholder={
              <span className="font-bold text-2xl text-muted-foreground">
                {activeOrg.name.charAt(0).toUpperCase()}
              </span>
            }
            value={activeOrg.logo}
          />
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions that affect your entire organization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-destructive/50 p-4">
            <div>
              <h4 className="font-medium">Delete Organization</h4>
              <p className="text-muted-foreground text-sm">
                Permanently delete this organization and all its data
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger>
                <Button disabled={isDeleting} variant="destructive">
                  {isDeleting ? "Deleting..." : "Delete Organization"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    the organization "{activeOrg.name}" and remove all
                    associated data including members, teams, and invitations.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleDeleteOrg}
                  >
                    Delete Organization
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
