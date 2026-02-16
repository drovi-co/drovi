import type {
  AgentPlaybookCreateRequest,
  AgentProfileCreateRequest,
  AgentRoleCreateRequest,
} from "@memorystack/api-types";
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
import { Separator } from "@memorystack/ui-core/separator";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { agentsAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  formatDateTime,
  statusBadgeClass,
} from "@/modules/agents/lib/agent-ui";

const AUTONOMY_TIERS = ["L0", "L1", "L2", "L3", "L4"] as const;

export function AgentsStudioPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const [roleDraft, setRoleDraft] = useState({
    role_key: "sales_sdr",
    name: "Sales SDR Agent",
    domain: "sales",
    description: "Handles lead prioritization and outreach preparation.",
  });
  const [profileDraft, setProfileDraft] = useState({
    role_id: "",
    name: "Default Production Profile",
    autonomy_tier: "L2" as (typeof AUTONOMY_TIERS)[number],
  });
  const [playbookDraft, setPlaybookDraft] = useState({
    role_id: "",
    name: "Outbound Mission Playbook",
    objective: "Qualify inbound signals and draft actionable outreach.",
  });
  const [deploymentDraft, setDeploymentDraft] = useState({
    role_id: "",
    profile_id: "",
    playbook_id: "",
  });

  const rolesQuery = useQuery({
    queryKey: ["agent-studio-roles", organizationId],
    queryFn: () => agentsAPI.listRoles(organizationId),
    enabled: Boolean(organizationId),
  });

  const profilesQuery = useQuery({
    queryKey: ["agent-studio-profiles", organizationId],
    queryFn: () => agentsAPI.listProfiles(organizationId),
    enabled: Boolean(organizationId),
  });

  const playbooksQuery = useQuery({
    queryKey: ["agent-studio-playbooks", organizationId],
    queryFn: () => agentsAPI.listPlaybooks(organizationId),
    enabled: Boolean(organizationId),
  });

  const deploymentsQuery = useQuery({
    queryKey: ["agent-studio-deployments", organizationId],
    queryFn: () => agentsAPI.listDeployments(organizationId),
    enabled: Boolean(organizationId),
  });

  const allLoaded = !(
    rolesQuery.isLoading ||
    profilesQuery.isLoading ||
    playbooksQuery.isLoading ||
    deploymentsQuery.isLoading
  );

  const primaryRoleId = rolesQuery.data?.[0]?.id ?? "";
  const primaryProfileId = profilesQuery.data?.[0]?.id ?? "";
  const primaryPlaybookId = playbooksQuery.data?.[0]?.id ?? "";

  const effectiveProfileRoleId = profileDraft.role_id || primaryRoleId;
  const effectivePlaybookRoleId = playbookDraft.role_id || primaryRoleId;
  const effectiveDeployment = useMemo(
    () => ({
      role_id: deploymentDraft.role_id || primaryRoleId,
      profile_id: deploymentDraft.profile_id || primaryProfileId,
      playbook_id: deploymentDraft.playbook_id || primaryPlaybookId,
    }),
    [
      deploymentDraft.playbook_id,
      deploymentDraft.profile_id,
      deploymentDraft.role_id,
      primaryPlaybookId,
      primaryProfileId,
      primaryRoleId,
    ]
  );

  const invalidateStudioQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["agent-studio-roles", organizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-studio-profiles", organizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-studio-playbooks", organizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-studio-deployments", organizationId],
      }),
    ]);
  };

  const createRoleMutation = useMutation({
    mutationFn: () =>
      agentsAPI.createRole({
        organization_id: organizationId,
        ...roleDraft,
      } satisfies AgentRoleCreateRequest),
    onSuccess: async () => {
      toast.success("Role created");
      await invalidateStudioQueries();
    },
    onError: () => {
      toast.error("Failed to create role");
    },
  });

  const createProfileMutation = useMutation({
    mutationFn: () =>
      agentsAPI.createProfile({
        organization_id: organizationId,
        role_id: effectiveProfileRoleId,
        name: profileDraft.name,
        autonomy_tier: profileDraft.autonomy_tier,
        permission_scope: {
          tools: ["memory.search", "browser.navigate", "desktop.fs.write"],
          sources: ["email", "documents", "crm"],
          channels: ["email", "slack", "teams", "api"],
          allow_external_send: false,
          allowed_domains: [],
        },
      } satisfies AgentProfileCreateRequest),
    onSuccess: async () => {
      toast.success("Profile created");
      await invalidateStudioQueries();
    },
    onError: () => {
      toast.error("Failed to create profile");
    },
  });

  const createPlaybookMutation = useMutation({
    mutationFn: () =>
      agentsAPI.createPlaybook({
        organization_id: organizationId,
        role_id: effectivePlaybookRoleId,
        name: playbookDraft.name,
        objective: playbookDraft.objective,
        status: "draft",
        constraints: {
          required_tools: ["memory.search", "browser.navigate"],
        },
        sop: {
          steps: [
            { action: "memory.search", prompt: "Collect context and changes." },
            {
              action: "browser.navigate",
              prompt: "Open assigned execution target.",
            },
          ],
        },
      } satisfies AgentPlaybookCreateRequest),
    onSuccess: async () => {
      toast.success("Playbook created");
      await invalidateStudioQueries();
    },
    onError: () => {
      toast.error("Failed to create playbook");
    },
  });

  const lintPlaybookMutation = useMutation({
    mutationFn: () =>
      agentsAPI.lintPlaybook({
        objective: playbookDraft.objective,
        constraints: {
          required_tools: ["memory.search", "browser.navigate"],
        },
        sop: {
          steps: [{ action: "memory.search" }, { action: "browser.navigate" }],
        },
      }),
    onSuccess: (result) => {
      if (result.valid) {
        toast.success("Playbook draft is valid");
      } else {
        toast.error(result.errors?.[0] ?? "Playbook validation failed");
      }
    },
    onError: () => {
      toast.error("Failed to lint playbook");
    },
  });

  const createDeploymentMutation = useMutation({
    mutationFn: () =>
      agentsAPI.createDeployment({
        organization_id: organizationId,
        role_id: effectiveDeployment.role_id,
        profile_id: effectiveDeployment.profile_id,
        playbook_id: effectiveDeployment.playbook_id,
        status: "draft",
      }),
    onSuccess: async () => {
      toast.success("Deployment created");
      await invalidateStudioQueries();
    },
    onError: () => {
      toast.error("Failed to create deployment");
    },
  });

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
        Select an organization to use Agent Studio.
      </div>
    );
  }

  const hasErrors =
    rolesQuery.isError ||
    profilesQuery.isError ||
    playbooksQuery.isError ||
    deploymentsQuery.isError;

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <Wrench className="h-3.5 w-3.5" />
            Agent Studio
          </div>
          <h1 className="font-semibold text-2xl">
            Design role, profile, playbook, deployment
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Build reusable AI coworkers from composable AgentOS primitives.
          </p>
        </div>
      </div>

      {hasErrors ? (
        <ApiErrorPanel
          error={
            rolesQuery.error ||
            profilesQuery.error ||
            playbooksQuery.error ||
            deploymentsQuery.error
          }
          onRetry={() => {
            rolesQuery.refetch();
            profilesQuery.refetch();
            playbooksQuery.refetch();
            deploymentsQuery.refetch();
          }}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4.5 w-4.5 text-primary" />
              Role
            </CardTitle>
            <CardDescription>Create domain role identities.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              onChange={(event) =>
                setRoleDraft((prev) => ({ ...prev, name: event.target.value }))
              }
              value={roleDraft.name}
            />
            <Label htmlFor="role-key">Role key</Label>
            <Input
              id="role-key"
              onChange={(event) =>
                setRoleDraft((prev) => ({
                  ...prev,
                  role_key: event.target.value,
                }))
              }
              value={roleDraft.role_key}
            />
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              onChange={(event) =>
                setRoleDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              value={roleDraft.description}
            />
            <Button
              className="w-full"
              disabled={createRoleMutation.isPending}
              onClick={() => createRoleMutation.mutate()}
              type="button"
            >
              {createRoleMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save role
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4.5 w-4.5 text-primary" />
              Profile
            </CardTitle>
            <CardDescription>
              Define autonomy, tool, and channel policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label>Role</Label>
            <Select
              onValueChange={(value) =>
                setProfileDraft((prev) => ({ ...prev, role_id: value }))
              }
              value={effectiveProfileRoleId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {(rolesQuery.data ?? []).map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              onChange={(event) =>
                setProfileDraft((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              value={profileDraft.name}
            />
            <Label>Autonomy tier</Label>
            <Select
              onValueChange={(value) =>
                setProfileDraft((prev) => ({
                  ...prev,
                  autonomy_tier: value as (typeof AUTONOMY_TIERS)[number],
                }))
              }
              value={profileDraft.autonomy_tier}
            >
              <SelectTrigger>
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                {AUTONOMY_TIERS.map((tier) => (
                  <SelectItem key={tier} value={tier}>
                    {tier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={
                createProfileMutation.isPending || !effectiveProfileRoleId
              }
              onClick={() => createProfileMutation.mutate()}
              type="button"
            >
              {createProfileMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save profile
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              Playbook
            </CardTitle>
            <CardDescription>
              Capture SOP steps and success criteria.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label>Role</Label>
            <Select
              onValueChange={(value) =>
                setPlaybookDraft((prev) => ({ ...prev, role_id: value }))
              }
              value={effectivePlaybookRoleId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {(rolesQuery.data ?? []).map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="playbook-name">Name</Label>
            <Input
              id="playbook-name"
              onChange={(event) =>
                setPlaybookDraft((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              value={playbookDraft.name}
            />
            <Label htmlFor="playbook-objective">Objective</Label>
            <Textarea
              id="playbook-objective"
              onChange={(event) =>
                setPlaybookDraft((prev) => ({
                  ...prev,
                  objective: event.target.value,
                }))
              }
              value={playbookDraft.objective}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={lintPlaybookMutation.isPending}
                onClick={() => lintPlaybookMutation.mutate()}
                type="button"
                variant="outline"
              >
                Lint draft
              </Button>
              <Button
                disabled={
                  createPlaybookMutation.isPending || !effectivePlaybookRoleId
                }
                onClick={() => createPlaybookMutation.mutate()}
                type="button"
              >
                {createPlaybookMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save playbook
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deployment</CardTitle>
            <CardDescription>
              Compose role, profile, and playbook into runtime snapshots.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label>Role</Label>
            <Select
              onValueChange={(value) =>
                setDeploymentDraft((prev) => ({ ...prev, role_id: value }))
              }
              value={effectiveDeployment.role_id}
            >
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {(rolesQuery.data ?? []).map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label>Profile</Label>
            <Select
              onValueChange={(value) =>
                setDeploymentDraft((prev) => ({ ...prev, profile_id: value }))
              }
              value={effectiveDeployment.profile_id}
            >
              <SelectTrigger>
                <SelectValue placeholder="Profile" />
              </SelectTrigger>
              <SelectContent>
                {(profilesQuery.data ?? []).map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label>Playbook</Label>
            <Select
              onValueChange={(value) =>
                setDeploymentDraft((prev) => ({ ...prev, playbook_id: value }))
              }
              value={effectiveDeployment.playbook_id}
            >
              <SelectTrigger>
                <SelectValue placeholder="Playbook" />
              </SelectTrigger>
              <SelectContent>
                {(playbooksQuery.data ?? []).map((playbook) => (
                  <SelectItem key={playbook.id} value={playbook.id}>
                    {playbook.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={
                createDeploymentMutation.isPending ||
                !effectiveDeployment.role_id ||
                !effectiveDeployment.profile_id ||
                !effectiveDeployment.playbook_id
              }
              onClick={() => createDeploymentMutation.mutate()}
              type="button"
            >
              {createDeploymentMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save deployment
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current studio inventory</CardTitle>
          <CardDescription>
            {allLoaded
              ? "Latest role/profile/playbook/deployment snapshots."
              : "Loading studio inventory…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="Roles" value={(rolesQuery.data ?? []).length} />
            <Metric
              label="Profiles"
              value={(profilesQuery.data ?? []).length}
            />
            <Metric
              label="Playbooks"
              value={(playbooksQuery.data ?? []).length}
            />
            <Metric
              label="Deployments"
              value={(deploymentsQuery.data ?? []).length}
            />
          </div>
          <Separator />
          <div className="grid gap-3 md:grid-cols-2">
            {(deploymentsQuery.data ?? []).slice(0, 8).map((deployment) => (
              <div className="rounded-lg border px-3 py-2" key={deployment.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{deployment.id}</p>
                  <Badge
                    className={statusBadgeClass(
                      "deployment",
                      deployment.status
                    )}
                  >
                    {deployment.status}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  Updated {formatDateTime(deployment.updated_at)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-1 font-semibold text-xl">{value}</p>
    </div>
  );
}
