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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useT } from "@/i18n";
import { useAdminAuthStore } from "@/lib/auth";
import { type NavItem, NavMain } from "./nav-main";

type NavItemTemplate = Omit<NavItem, "title"> & { titleKey: string };

const overviewNav: NavItemTemplate[] = [
  { titleKey: "admin.nav.items.overview", url: "/dashboard", icon: Activity },
];

const opsNav: NavItemTemplate[] = [
  {
    titleKey: "admin.nav.items.organizations",
    url: "/dashboard/orgs",
    icon: Building2,
  },
  { titleKey: "admin.nav.items.users", url: "/dashboard/users", icon: Users },
  {
    titleKey: "admin.nav.items.connectors",
    url: "/dashboard/connectors",
    icon: Cable,
  },
  { titleKey: "admin.nav.items.jobs", url: "/dashboard/jobs", icon: Layers3 },
  {
    titleKey: "admin.nav.items.tickets",
    url: "/dashboard/tickets",
    icon: Inbox,
  },
  {
    titleKey: "admin.nav.items.exchange",
    url: "/dashboard/exchange",
    icon: Gavel,
  },
];

export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const t = useT();
  const me = useAdminAuthStore((s) => s.me);
  const logout = useAdminAuthStore((s) => s.logout);

  const overviewItems: NavItem[] = overviewNav.map((item) => ({
    ...item,
    title: t(item.titleKey),
  }));
  const opsItems: NavItem[] = opsNav.map((item) => ({
    ...item,
    title: t(item.titleKey),
  }));

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center">
        <div className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="h-8 w-8 rounded-lg bg-foreground" />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate font-semibold text-sm leading-tight">
              {t("admin.appName")}
            </div>
            <div className="truncate text-[11px] text-muted-foreground leading-tight">
              {t("admin.tagline")}
            </div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <NavMain
          items={overviewItems}
          label={t("admin.nav.groups.dashboard")}
        />
        <NavMain items={opsItems} label={t("admin.nav.groups.operations")} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="justify-between"
              onClick={() => logout()}
              tooltip={t("admin.actions.logout")}
            >
              <span className="truncate text-muted-foreground text-xs">
                {me?.email ?? t("admin.userFallback")}
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
