// =============================================================================
// CONTINUUM EXCHANGE
// =============================================================================
//
// Marketplace for Continuum bundles: publish, browse, install, govern.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  Box,
  CloudDownload,
  Crown,
  FileCode2,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
  continuumExchangeAPI,
  type ContinuumBundle,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/exchange")({
  component: ContinuumExchangePage,
});

const VISIBILITY_BADGES: Record<string, string> = {
  private: "border-slate-400/30 bg-slate-400/10 text-slate-600",
  public: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  curated: "border-violet-500/30 bg-violet-500/10 text-violet-600",
};

const GOVERNANCE_BADGES: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  rejected: "border-red-500/30 bg-red-500/10 text-red-600",
};

function formatPrice(bundle: ContinuumBundle) {
  if (!bundle.priceCents || !bundle.currency) {
    return "Free";
  }
  return `${(bundle.priceCents / 100).toFixed(2)} ${bundle.currency}`;
}

function ContinuumExchangePage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const [filters, setFilters] = useState({
    visibility: "all",
    governance: "all",
  });
  const [publishOpen, setPublishOpen] = useState(false);
  const [manifestText, setManifestText] = useState(
    JSON.stringify(
      {
        name: "Customer Success Health",
        description: "Continuum bundle for proactive churn prevention.",
        version: "1.0.0",
        steps: [
          {
            id: "scan_risk",
            name: "Scan account risk",
            action: "memory.scan_risk",
          },
        ],
      },
      null,
      2
    )
  );
  const [bundleName, setBundleName] = useState("Customer Success Health");
  const [bundleDescription, setBundleDescription] = useState(
    "Continuum bundle for proactive churn prevention."
  );
  const [bundleVisibility, setBundleVisibility] = useState<
    "private" | "public" | "curated"
  >("private");

  const {
    data: bundles,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["continuum-exchange", organizationId, filters],
    queryFn: () =>
      continuumExchangeAPI.list({
        organizationId,
        visibility: filters.visibility === "all" ? undefined : filters.visibility,
        governanceStatus:
          filters.governance === "all" ? undefined : filters.governance,
      }),
    enabled: !!organizationId,
  });

  const installMutation = useMutation({
    mutationFn: (bundle: ContinuumBundle) =>
      continuumExchangeAPI.install({
        organizationId,
        bundleId: bundle.id,
      }),
    onSuccess: () => {
      toast.success("Bundle installed");
      queryClient.invalidateQueries({ queryKey: ["continuum-exchange"] });
    },
    onError: () => toast.error("Failed to install bundle"),
  });

  const publishMutation = useMutation({
    mutationFn: (manifest: Record<string, unknown>) =>
      continuumExchangeAPI.publish({
        organizationId,
        manifest,
        visibility: bundleVisibility,
        governanceStatus: "pending",
      }),
    onSuccess: () => {
      toast.success("Bundle submitted for review");
      setPublishOpen(false);
      queryClient.invalidateQueries({ queryKey: ["continuum-exchange"] });
    },
    onError: () => toast.error("Failed to publish bundle"),
  });

  const curatedBundles = useMemo(() => {
    return (bundles ?? []).filter((bundle) => bundle.visibility === "curated");
  }, [bundles]);

  const handlePublish = () => {
    try {
      const parsed = JSON.parse(manifestText) as Record<string, unknown>;
      parsed.name = bundleName;
      parsed.description = bundleDescription;
      publishMutation.mutate(parsed);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Invalid JSON manifest"
      );
    }
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select an organization to browse the Exchange
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {error instanceof Error
          ? error.message
          : "Unable to load the Continuum Exchange"}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Store className="h-3 w-3" />
              Continuum Exchange
            </div>
            <h1 className="font-semibold text-2xl">
              Install proven intelligence playbooks
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Discover curated Continuums, publish your own playbooks, and keep
              governance tight.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setPublishOpen(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Publish bundle
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Discovery Filters
              </CardTitle>
              <CardDescription>
                Narrow the marketplace to the bundles you want now.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, visibility: value }))
                  }
                  value={filters.visibility}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="curated">Curated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Governance</Label>
                <Select
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, governance: value }))
                  }
                  value={filters.governance}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {isLoading ? (
              <Card>
                <CardContent className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : (bundles ?? []).length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
                  <Box className="h-10 w-10" />
                  <p className="font-medium">No bundles yet</p>
                  <p className="text-sm">
                    Publish your first bundle to bootstrap the Exchange.
                  </p>
                </CardContent>
              </Card>
            ) : (
              (bundles ?? []).map((bundle) => (
                <Card key={bundle.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">{bundle.name}</CardTitle>
                        <CardDescription>
                          {bundle.description ?? "No description"}
                        </CardDescription>
                      </div>
                      <Badge
                        className={cn(
                          "border",
                          VISIBILITY_BADGES[bundle.visibility] ||
                            "border-muted"
                        )}
                        variant="outline"
                      >
                        {bundle.visibility}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge
                        className={cn(
                          "border",
                          GOVERNANCE_BADGES[bundle.governanceStatus] ||
                            "border-muted"
                        )}
                        variant="outline"
                      >
                        {bundle.governanceStatus}
                      </Badge>
                      <Badge variant="secondary">v{bundle.version}</Badge>
                      <Badge variant="secondary">{formatPrice(bundle)}</Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => installMutation.mutate(bundle)}
                        size="sm"
                      >
                        <CloudDownload className="mr-2 h-4 w-4" />
                        Install
                      </Button>
                      <Button size="sm" variant="ghost">
                        <FileCode2 className="mr-2 h-4 w-4" />
                        View manifest
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Crown className="h-4 w-4 text-primary" />
                Curated picks
              </CardTitle>
              <CardDescription>
                Reviewed by Drovi governance for immediate adoption.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {curatedBundles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">
                  No curated bundles yet.
                </div>
              ) : (
                curatedBundles.map((bundle) => (
                  <div
                    className="rounded-lg border bg-muted/40 p-3"
                    key={bundle.id}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{bundle.name}</p>
                        <p className="text-muted-foreground text-xs">
                          v{bundle.version}
                        </p>
                      </div>
                      <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                        Approved
                      </Badge>
                    </div>
                    <Button
                      className="mt-3 w-full"
                      onClick={() => installMutation.mutate(bundle)}
                      size="sm"
                      variant="outline"
                    >
                      Install curated bundle
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Governance signals
              </CardTitle>
              <CardDescription>
                Keep approvals and governance visible.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Pending review", value: "Autopilot rules" },
                { label: "Approved", value: "Executive cadence" },
                { label: "Rejected", value: "Noisy intents" },
              ].map((item) => (
                <div
                  className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm"
                  key={item.label}
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish Continuum Bundle</DialogTitle>
            <DialogDescription>
              Upload a manifest. Governance review is required before public
              listing.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  onChange={(event) => setBundleName(event.target.value)}
                  value={bundleName}
                />
              </div>
              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select
                  onValueChange={(value) =>
                    setBundleVisibility(value as "private" | "public" | "curated")
                  }
                  value={bundleVisibility}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="curated">Curated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                onChange={(event) => setBundleDescription(event.target.value)}
                value={bundleDescription}
              />
            </div>
            <div className="space-y-2">
              <Label>Bundle manifest (JSON)</Label>
              <Textarea
                className="min-h-[220px] font-mono text-xs"
                onChange={(event) => setManifestText(event.target.value)}
                value={manifestText}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={publishMutation.isPending}
                onClick={handlePublish}
              >
                {publishMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BadgeCheck className="mr-2 h-4 w-4" />
                )}
                Submit for review
              </Button>
              <Badge variant="secondary">
                {bundleVisibility === "curated"
                  ? "Requires admin approval"
                  : "Draft review"}
              </Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
