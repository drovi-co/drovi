import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
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

export const Route = createFileRoute("/onboarding/create-org")({
  component: CreateOrgPage,
});

function CreateOrgPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Auto-generate slug from name
  const handleNameChange = (value: string) => {
    setName(value);
    const generatedSlug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setSlug(generatedSlug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(name && slug)) {
      return;
    }

    setIsCreating(true);

    try {
      const result = await authClient.organization.create({
        name,
        slug,
      });

      if (result.error) {
        toast.error(result.error.message || "Failed to create organization");
        setIsCreating(false);
        return;
      }

      // Set as active organization
      if (result.data) {
        const setActiveResult = await authClient.organization.setActive({
          organizationId: result.data.id,
        });

        if (setActiveResult.error) {
          console.error("Failed to set active org:", setActiveResult.error);
          // Continue anyway - org was created
        }
      }

      toast.success("Organization created!");

      // Navigate to connect sources (was connect-email)
      // Use a small delay to ensure state is updated
      setTimeout(() => {
        navigate({ to: "/onboarding/connect-sources" });
      }, 100);
    } catch (error) {
      console.error("Organization creation error:", error);
      toast.error("An unexpected error occurred");
      setIsCreating(false);
    }
  };

  return (
    <OnboardingLayout step={1}>
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="pb-2 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">Create Your Organization</CardTitle>
          <CardDescription className="text-base">
            Set up your workspace to start collaborating with your team
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input
                autoFocus
                className="h-11"
                id="name"
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Inc."
                required
                value={name}
              />
              <p className="text-muted-foreground text-xs">
                This is the name that will be displayed to your team
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Organization URL</Label>
              <div className="relative">
                <Globe className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-11 pl-10"
                  id="slug"
                  onChange={(e) =>
                    setSlug(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                    )
                  }
                  placeholder="acme-inc"
                  required
                  value={slug}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                drovi.io/
                <span className="font-medium">{slug || "your-org"}</span>
              </p>
            </div>

            <Button
              className="mt-2 h-11 w-full"
              disabled={isCreating || !name || !slug}
              type="submit"
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating organization...
                </>
              ) : (
                "Create Organization"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-muted-foreground text-sm">
        You can always change these settings later in your organization settings
      </p>
    </OnboardingLayout>
  );
}
