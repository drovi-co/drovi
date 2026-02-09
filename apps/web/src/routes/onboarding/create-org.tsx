import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Globe, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/i18n";
import { orgAPI } from "@/lib/api";

export const Route = createFileRoute("/onboarding/create-org")({
  component: CreateOrgPage,
});

function CreateOrgPage() {
  const navigate = useNavigate();
  const t = useT();
  const [name, setName] = useState("");
  const [region, setRegion] = useState("us-west");

  const {
    data: orgInfo,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
  });

  useEffect(() => {
    if (orgInfo) {
      setName(orgInfo.name ?? "");
      setRegion(orgInfo.region ?? "us-west");
    }
  }, [orgInfo]);

  const updateOrgMutation = useMutation({
    mutationFn: () =>
      orgAPI.updateOrgInfo({
        name,
        region,
      }),
    onSuccess: () => {
      toast.success(t("onboarding.createOrg.toasts.updated"));
      navigate({ to: "/onboarding/connect-sources" });
    },
    onError: (error: Error) => {
      toast.error(error.message || t("onboarding.createOrg.toasts.failed"));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    updateOrgMutation.mutate();
  };

  return (
    <OnboardingLayout step={1}>
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="pb-2 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t("onboarding.createOrg.title")}</CardTitle>
          <CardDescription className="text-base">
            {t("onboarding.createOrg.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <ApiErrorPanel error={error} onRetry={() => refetch()} />
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="name">{t("onboarding.createOrg.fields.name.label")}</Label>
                <Input
                  autoFocus
                  className="h-11"
                  id="name"
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("onboarding.createOrg.fields.name.placeholder")}
                  required
                  value={name}
                />
                <p className="text-muted-foreground text-xs">
                  {t("onboarding.createOrg.fields.name.hint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="region">{t("onboarding.createOrg.fields.region.label")}</Label>
                <div className="relative">
                  <Globe className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Select onValueChange={(value) => setRegion(value)} value={region}>
                    <SelectTrigger className="h-11 pl-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="us-west">{t("onboarding.createOrg.fields.region.options.usWest")}</SelectItem>
                      <SelectItem value="us-east">{t("onboarding.createOrg.fields.region.options.usEast")}</SelectItem>
                      <SelectItem value="eu-west">{t("onboarding.createOrg.fields.region.options.euWest")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("onboarding.createOrg.fields.region.hint")}
                </p>
              </div>

              <Button
                className="mt-2 h-11 w-full"
                disabled={updateOrgMutation.isPending || !name}
                type="submit"
              >
                {updateOrgMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("onboarding.createOrg.saving")}
                  </>
                ) : (
                  t("common.actions.continue")
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-muted-foreground text-sm">
        {t("onboarding.createOrg.footerNote")}
      </p>
    </OnboardingLayout>
  );
}
