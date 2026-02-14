import type { AgentCatalogItem } from "@memorystack/api-types";
import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { ScrollArea } from "@memorystack/ui-core/scroll-area";
import { Separator } from "@memorystack/ui-core/separator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Briefcase,
  ClipboardCopy,
  DatabaseZap,
  Loader2,
  Mail,
  Plug,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { agentsAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  formatDateTime,
  statusBadgeClass,
} from "@/modules/agents/lib/agent-ui";

interface StarterPack {
  id: string;
  title: string;
  domain: string;
  description: string;
  autonomyTier: "L1" | "L2" | "L3";
  objective: string;
  requiredTools: string[];
  channels: Array<"email" | "slack" | "teams" | "api" | "desktop">;
  sources: string[];
}

const STARTER_PACKS: StarterPack[] = [
  {
    id: "sales-sdr",
    title: "Sales SDR Agent",
    domain: "sales",
    description:
      "Qualifies inbound leads, drafts outreach, and keeps follow-up velocity visible.",
    autonomyTier: "L2",
    objective:
      "Triage inbound lead signals, enrich context from CRM/email, and draft next-best outreach actions.",
    requiredTools: [
      "memory.search",
      "crm.read",
      "email.draft",
      "browser.navigate",
    ],
    channels: ["email", "slack"],
    sources: ["email", "crm", "calendar"],
  },
  {
    id: "hr-onboarding",
    title: "HR Onboarding Manager",
    domain: "hr",
    description:
      "Coordinates onboarding workflows, missing tasks, policy handoffs, and manager nudges.",
    autonomyTier: "L2",
    objective:
      "Track onboarding completion gaps and prepare policy-compliant checklists for HR and managers.",
    requiredTools: [
      "memory.search",
      "documents.search",
      "ticket.create",
      "email.send",
    ],
    channels: ["email", "slack", "teams"],
    sources: ["documents", "email", "chat"],
  },
  {
    id: "legal-advice-timeline",
    title: "Legal Advice Timeline Sentinel",
    domain: "legal",
    description:
      "Builds bi-temporal advice trails, contradiction alerts, and evidence-backed legal chronology.",
    autonomyTier: "L3",
    objective:
      "Continuously detect legal advice drift, contradictions, and unresolved risk with evidence citations.",
    requiredTools: [
      "memory.search",
      "documents.search",
      "risk.score",
      "email.send",
    ],
    channels: ["email", "teams"],
    sources: ["documents", "email", "meetings"],
  },
  {
    id: "accounting-filing-watch",
    title: "Accounting Filing & Missing Docs Agent",
    domain: "accounting",
    description:
      "Monitors filing deadlines, missing inputs, and follow-up silence before deadlines break.",
    autonomyTier: "L2",
    objective:
      "Track filing risks and produce evidence-based reminders with escalation context.",
    requiredTools: [
      "memory.search",
      "documents.search",
      "calendar.read",
      "email.send",
    ],
    channels: ["email"],
    sources: ["documents", "email", "calendar"],
  },
];

function makeRoleKey(pack: StarterPack): string {
  const suffix = Date.now().toString(36).slice(-6);
  return `${pack.domain}.${pack.id.replace(/[^a-z0-9]+/gi, "_")}_${suffix}`;
}

function installSnippet(organizationId: string) {
  return `curl -X POST http://localhost:8000/api/v1/agents/runs \\
  -H "Content-Type: application/json" \\
  -H "Cookie: session=<your-session-cookie>" \\
  -d '{"organization_id":"${organizationId}","deployment_id":"agdep_x","payload":{"mission":"Draft a risk update"}}'`;
}

export function AgentsCatalogPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const catalogQuery = useQuery({
    queryKey: ["agent-catalog", organizationId],
    queryFn: () => agentsAPI.listCatalog(organizationId),
    enabled: Boolean(organizationId),
  });

  const inventoryQuery = useQuery({
    queryKey: ["agent-catalog-inventory", organizationId],
    queryFn: async () => {
      const [roles, profiles, playbooks, deployments] = await Promise.all([
        agentsAPI.listRoles(organizationId),
        agentsAPI.listProfiles(organizationId),
        agentsAPI.listPlaybooks(organizationId),
        agentsAPI.listDeployments(organizationId),
      ]);
      return {
        roles,
        profiles,
        playbooks,
        deployments,
      };
    },
    enabled: Boolean(organizationId),
  });

  const installMutation = useMutation({
    mutationFn: async (pack: StarterPack) => {
      const role = await agentsAPI.createRole({
        organization_id: organizationId,
        role_key: makeRoleKey(pack),
        name: pack.title,
        domain: pack.domain,
        description: pack.description,
      });

      const profile = await agentsAPI.createProfile({
        organization_id: organizationId,
        role_id: role.id,
        name: `${pack.title} Profile`,
        autonomy_tier: pack.autonomyTier,
        permission_scope: {
          tools: pack.requiredTools,
          sources: pack.sources,
          channels: pack.channels,
          allow_external_send: false,
          allowed_domains: [],
        },
      });

      const playbook = await agentsAPI.createPlaybook({
        organization_id: organizationId,
        role_id: role.id,
        name: `${pack.title} Playbook`,
        objective: pack.objective,
        constraints: {
          required_tools: pack.requiredTools,
        },
        sop: {
          steps: [
            {
              action: "memory.search",
              prompt:
                "Collect historical context, commitments, and risk indicators.",
            },
            {
              action: "documents.search",
              prompt: "Cross-reference latest documents and source evidence.",
            },
            {
              action: "email.draft",
              prompt: "Prepare a proof-first communication draft for review.",
            },
          ],
        },
        status: "draft",
      });

      const deployment = await agentsAPI.createDeployment({
        organization_id: organizationId,
        role_id: role.id,
        profile_id: profile.id,
        playbook_id: playbook.id,
        status: "draft",
      });

      return {
        role,
        profile,
        playbook,
        deployment,
      };
    },
    onSuccess: async (_result, pack) => {
      toast.success(`${pack.title} installed in Agent Studio`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["agent-catalog", organizationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["agent-catalog-inventory", organizationId],
        }),
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
    },
    onError: () => {
      toast.error("Failed to install starter pack");
    },
  });

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(installSnippet(organizationId));
      toast.success("API snippet copied");
    } catch {
      toast.error("Unable to copy API snippet");
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
        Select an organization to open Agent Catalog.
      </div>
    );
  }

  const inventory = inventoryQuery.data;

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <Store className="h-3.5 w-3.5" />
            Agent Catalog
          </div>
          <h1 className="font-semibold text-2xl">
            Install workforce starter packs
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Deploy pre-wired AI employee templates, then customize in Studio for
            your org language, policy, and tools.
          </p>
        </div>
      </div>

      {inventoryQuery.isError ? (
        <ApiErrorPanel
          error={inventoryQuery.error}
          onRetry={() => inventoryQuery.refetch()}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={Bot} label="Roles" value={inventory?.roles.length ?? 0} />
        <Metric
          icon={Users}
          label="Profiles"
          value={inventory?.profiles.length ?? 0}
        />
        <Metric
          icon={Briefcase}
          label="Playbooks"
          value={inventory?.playbooks.length ?? 0}
        />
        <Metric
          icon={DatabaseZap}
          label="Deployments"
          value={inventory?.deployments.length ?? 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Starter packs</CardTitle>
          <CardDescription>
            One-click installs for common AI employee roles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            {STARTER_PACKS.map((pack) => (
              <article className="rounded-xl border p-4" key={pack.id}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-medium text-sm">{pack.title}</h2>
                  <Badge className="border border-primary/25 bg-primary/10 text-primary">
                    {pack.autonomyTier}
                  </Badge>
                </div>
                <p className="mt-2 text-muted-foreground text-sm">
                  {pack.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {pack.requiredTools.slice(0, 4).map((toolId) => (
                    <Badge key={toolId} variant="outline">
                      {toolId}
                    </Badge>
                  ))}
                </div>
                <Button
                  className="mt-4 w-full"
                  disabled={installMutation.isPending}
                  onClick={() => installMutation.mutate(pack)}
                  type="button"
                >
                  {installMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Install to Agent Studio
                </Button>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid min-h-0 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">
              Organization catalog inventory
            </CardTitle>
            <CardDescription>
              Active and draft deployments available to run.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
            {catalogQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading catalog inventory…
              </div>
            ) : catalogQuery.isError ? (
              <ApiErrorPanel
                error={catalogQuery.error}
                onRetry={() => catalogQuery.refetch()}
              />
            ) : (
              <CatalogTable items={catalogQuery.data ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="h-4.5 w-4.5 text-primary" />
              API and webhook access
            </CardTitle>
            <CardDescription>
              External systems can trigger and monitor AgentOS workflows
              directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">Run trigger</p>
              <p className="mt-1 text-muted-foreground">
                POST `/api/v1/agents/runs`
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">Channel ingress</p>
              <p className="mt-1 text-muted-foreground">
                POST `/api/v1/agents/inbox/events/email|slack|teams`
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium">Approvals</p>
              <p className="mt-1 text-muted-foreground">
                GET/POST `/api/v1/agents/approvals` and decision endpoints.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="font-medium text-sm">Quick run API snippet</p>
              <pre className="overflow-x-auto rounded-lg border bg-muted p-3 text-[11px] leading-relaxed">
                {installSnippet(organizationId)}
              </pre>
              <Button onClick={copySnippet} type="button" variant="outline">
                <ClipboardCopy className="mr-2 h-4 w-4" />
                Copy snippet
              </Button>
            </div>

            <Separator />

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 h-4 w-4 text-primary" />
                <p className="text-muted-foreground">
                  Use Agent Inbox to bind Slack/Teams/email channels and route
                  live tasks into deployed agents.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CatalogTable({ items }: { items: AgentCatalogItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
        No catalog records yet. Install a starter pack or publish a deployment
        from Studio.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[360px] pr-2">
      <div className="space-y-2">
        {items.map((item) => (
          <div className="rounded-lg border px-3 py-2" key={item.deployment_id}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{item.role_name}</p>
              <Badge
                className={statusBadgeClass(
                  "deployment",
                  item.deployment_status
                )}
              >
                {item.deployment_status}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {item.playbook_name} · v{item.deployment_version} · Updated{" "}
              {formatDateTime(item.updated_at)}
            </p>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Bot;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 font-semibold text-2xl">{value}</p>
    </div>
  );
}
