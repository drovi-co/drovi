import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Bot, Wrench } from "lucide-react";

interface LegacySurfaceMeta {
  title: string;
  description: string;
  migrationReason: string;
}

const LEGACY_META: Record<
  "continuums" | "builder" | "exchange",
  LegacySurfaceMeta
> = {
  continuums: {
    title: "Continuums moved to AgentOS Workforces",
    description:
      "Continuums runtime is now replaced by AgentOS deployments and mission runs.",
    migrationReason:
      "Use Workforces to dispatch missions and monitor run state in real time.",
  },
  builder: {
    title: "Continuum Builder moved to Agent Studio",
    description:
      "Authoring now happens in Agent Studio with role/profile/playbook/deployment primitives.",
    migrationReason:
      "Build production-safe agents with policy overlays, approvals, and audited runtime snapshots.",
  },
  exchange: {
    title: "Continuum Exchange moved to Agent Catalog",
    description:
      "Template install and deployment inventory are now centralized in Agent Catalog.",
    migrationReason:
      "Install starter packs and integrate external systems through AgentOS APIs and inbox channels.",
  },
};

export function AgentsMigrationPage({
  surface,
}: {
  surface: "continuums" | "builder" | "exchange";
}) {
  const navigate = useNavigate();
  const meta = LEGACY_META[surface];

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 via-background to-background">
        <CardHeader>
          <Badge className="mb-2 w-fit border border-primary/30 bg-primary/10 text-primary">
            AgentOS Migration
          </Badge>
          <CardTitle className="text-2xl">{meta.title}</CardTitle>
          <CardDescription className="max-w-3xl text-base">
            {meta.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {meta.migrationReason}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <Button
              onClick={() => navigate({ to: "/dashboard/agents/workforces" })}
              type="button"
              variant="default"
            >
              <Bot className="mr-2 h-4 w-4" />
              Open Workforces
            </Button>
            <Button
              onClick={() => navigate({ to: "/dashboard/agents/studio" })}
              type="button"
              variant="outline"
            >
              <Wrench className="mr-2 h-4 w-4" />
              Open Studio
            </Button>
            <Button
              onClick={() => navigate({ to: "/dashboard/agents/catalog" })}
              type="button"
              variant="outline"
            >
              <ArrowRight className="mr-2 h-4 w-4" />
              Open Catalog
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
