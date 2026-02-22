import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@memorystack/ui-core/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@memorystack/ui-core/sidebar";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export function TeamSwitcher() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();

  const { data: organizations, isPending: orgsLoading } =
    authClient.useListOrganizations();
  const { data: activeOrg, isPending: activeOrgLoading } =
    authClient.useActiveOrganization();
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);

  const handleOrgSwitch = async (orgId: string) => {
    if (activeOrg?.id === orgId || switchingOrgId) {
      return;
    }
    try {
      setSwitchingOrgId(orgId);
      await authClient.organization.setActive({ organizationId: orgId });
      const targetOrg = organizations?.find((org) => org.id === orgId);
      toast.success(`Switched to ${targetOrg?.name ?? "organization"}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to switch organization"
      );
    } finally {
      setSwitchingOrgId(null);
    }
  };

  const handleCreateOrg = () => {
    navigate({ to: "/onboarding/create-org" });
  };

  if (orgsLoading || activeOrgLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton className="animate-pulse" size="lg">
            <div className="h-8 w-8 rounded-lg bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // If no organizations exist, show create button
  if (!organizations?.length) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="border-2 border-dashed"
            onClick={handleCreateOrg}
            size="lg"
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Plus className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">
                Create Organization
              </span>
              <span className="truncate text-muted-foreground text-xs">
                Get started
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const currentOrg = activeOrg ?? organizations[0];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              size="lg"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <span className="font-bold text-xs">
                  {currentOrg?.name?.charAt(0).toUpperCase() ?? "?"}
                </span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {currentOrg?.name ?? "Select Organization"}
                </span>
                <span className="truncate text-muted-foreground text-xs capitalize">
                  {activeOrg ? "Active" : "No active org"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Organizations
            </DropdownMenuLabel>
            {organizations?.map((org) => (
              <DropdownMenuItem
                className="gap-2 p-2"
                disabled={switchingOrgId !== null}
                key={org.id}
                onClick={() => handleOrgSwitch(org.id)}
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <span className="font-bold text-xs">
                    {org.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="flex-1">{org.name}</span>
                {switchingOrgId === org.id ? (
                  <span className="text-muted-foreground text-xs">
                    Switching...
                  </span>
                ) : org.id === activeOrg?.id ? (
                  <span className="text-muted-foreground text-xs">Active</span>
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" onClick={handleCreateOrg}>
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <span className="font-medium text-muted-foreground">
                Create organization
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
