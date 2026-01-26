"use client";

import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  ChevronsUpDown,
  LogOut,
  Plus,
  Search,
  Settings,
  User,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface NewAppHeaderProps {
  onSearchClick?: () => void;
  onComposeClick?: () => void;
  className?: string;
}

export function NewAppHeader({
  onSearchClick,
  onComposeClick,
  className,
}: NewAppHeaderProps) {
  const navigate = useNavigate();
  const { data: session, isPending: sessionLoading } = useSession();
  const { data: organizations, isPending: orgsLoading } =
    authClient.useListOrganizations();
  const { data: activeOrg, isPending: activeOrgLoading } =
    authClient.useActiveOrganization();

  const handleOrgSwitch = async (orgId: string) => {
    await authClient.organization.setActive({ organizationId: orgId });
  };

  const handleCreateOrg = () => {
    navigate({ to: "/onboarding/create-org" });
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    navigate({ to: "/login" });
  };

  const user = session?.user;
  const currentOrg = activeOrg ?? organizations?.[0];
  const isLoading = sessionLoading || orgsLoading || activeOrgLoading;

  return (
    <header
      className={cn(
        "flex h-14 items-center gap-4 border-b border-border bg-background px-4",
        className
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          onClick={() => navigate({ to: "/dashboard" })}
          type="button"
        >
          D
        </button>

        {/* Org Switcher */}
        {isLoading ? (
          <Skeleton className="h-8 w-32" />
        ) : currentOrg ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-8 gap-2 px-2 font-medium"
                variant="ghost"
              >
                {currentOrg.logo ? (
                  <img
                    alt={currentOrg.name}
                    className="h-5 w-5 rounded object-cover"
                    src={currentOrg.logo}
                  />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-bold">
                    {currentOrg.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="max-w-24 truncate text-[13px]">
                  {currentOrg.name}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Switch Organization
              </DropdownMenuLabel>
              {organizations?.map((org) => (
                <DropdownMenuItem
                  className="gap-2"
                  key={org.id}
                  onClick={() => handleOrgSwitch(org.id)}
                >
                  {org.logo ? (
                    <img
                      alt={org.name}
                      className="h-5 w-5 rounded object-cover"
                      src={org.logo}
                    />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[10px] font-bold">
                      {org.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="flex-1 truncate">{org.name}</span>
                  {org.id === activeOrg?.id && (
                    <span className="text-[10px] text-muted-foreground">
                      Active
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={handleCreateOrg}>
                <Plus className="h-4 w-4" />
                <span>Create organization</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            className="h-8 gap-2 border-dashed"
            onClick={handleCreateOrg}
            size="sm"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            Create Organization
          </Button>
        )}
      </div>

      {/* Search Bar - Center */}
      <div className="flex-1 flex justify-center px-4">
        <Button
          className="h-9 w-full max-w-md justify-start gap-2 bg-muted/50 text-muted-foreground hover:bg-muted"
          onClick={onSearchClick}
          variant="ghost"
        >
          <Search className="h-4 w-4" />
          <span className="text-[13px]">Search everything...</span>
          <kbd className="ml-auto hidden rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
            ⌘K
          </kbd>
        </Button>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Compose button */}
        {onComposeClick && (
          <Button
            className="h-8 gap-2"
            onClick={onComposeClick}
            size="sm"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Compose</span>
          </Button>
        )}

        {/* Notifications */}
        <Button
          className="h-8 w-8"
          onClick={() => navigate({ to: "/dashboard/notifications" })}
          size="icon"
          variant="ghost"
        >
          <Bell className="h-4 w-4" />
        </Button>

        {/* User menu */}
        {isLoading ? (
          <Skeleton className="h-8 w-8 rounded-full" />
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-8 w-8 rounded-full p-0"
                variant="ghost"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    alt={user.name ?? "User"}
                    src={user.image ?? undefined}
                  />
                  <AvatarFallback className="text-xs">
                    {user.name?.charAt(0).toUpperCase() ??
                      user.email?.charAt(0).toUpperCase() ??
                      "U"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/settings" })}
              >
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate({ to: "/dashboard/settings" })}
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}
