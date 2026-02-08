import {
  Activity,
  Building2,
  Cable,
  Gavel,
  Inbox,
  Layers3,
  LogOut,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavMain, type NavItem } from "./nav-main";
import { useAdminAuthStore } from "@/lib/auth";

const overviewNav: NavItem[] = [
  { title: "Overview", url: "/dashboard", icon: Activity },
];

const opsNav: NavItem[] = [
  { title: "Organizations", url: "/dashboard/orgs", icon: Building2 },
  { title: "Users", url: "/dashboard/users", icon: Users },
  { title: "Connectors", url: "/dashboard/connectors", icon: Cable },
  { title: "Jobs", url: "/dashboard/jobs", icon: Layers3 },
  { title: "Tickets", url: "/dashboard/tickets", icon: Inbox },
  { title: "Exchange", url: "/dashboard/exchange", icon: Gavel },
];

export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const me = useAdminAuthStore((s) => s.me);
  const logout = useAdminAuthStore((s) => s.logout);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center">
        <div className="flex items-center gap-2 px-2">
          <div className="h-8 w-8 rounded-lg bg-foreground" />
          <div className="flex-1">
            <div className="truncate font-semibold text-sm leading-tight">
              Drovi Admin
            </div>
            <div className="truncate text-muted-foreground text-[11px] leading-tight">
              Live operations
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={overviewNav} label="Dashboard" />
        <NavMain items={opsNav} label="Operations" />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="justify-between"
              onClick={() => void logout()}
              tooltip="Log out"
            >
              <span className="truncate text-xs text-muted-foreground">
                {me?.email ?? "Admin"}
              </span>
              <LogOut className="size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
