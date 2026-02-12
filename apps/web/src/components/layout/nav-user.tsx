import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@memorystack/ui-core/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Settings,
  Sparkles,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function NavUser() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  const user = session?.user;

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate({ to: "/login" });
  };

  if (isPending) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton className="animate-pulse" size="lg">
            <div className="h-8 w-8 rounded-lg bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-3 w-32 rounded bg-muted" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (!user) {
    return null;
  }

  const displayName =
    user.name ?? user.email?.split("@")[0]?.replace(/\./g, " ") ?? "User";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              size="lg"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage alt={displayName} src={user.image ?? undefined} />
                <AvatarFallback className="rounded-lg">
                  {initials ?? "U"}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{displayName}</span>
                <span className="truncate text-muted-foreground text-xs">
                  {user.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage
                    alt={displayName}
                    src={user.image ?? undefined}
                  />
                  <AvatarFallback className="rounded-lg">
                    {initials ?? "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{displayName}</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/actuations" })}
              >
                <Sparkles className="mr-2 size-4" />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/settings" })}
              >
                <BadgeCheck className="mr-2 size-4" />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/actuations" })}
              >
                <CreditCard className="mr-2 size-4" />
                Actuations
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/trust" })}
              >
                <Bell className="mr-2 size-4" />
                Trust & Audit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/settings" })}
              >
                <Settings className="mr-2 size-4" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
