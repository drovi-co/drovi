"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  Calendar,
  CheckCheck,
  CheckCircle2,
  Loader2,
  Mail,
  MoreHorizontal,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { queryClient, useTRPC } from "@/utils/trpc";
import { NotificationCard } from "./notification-card";

// =============================================================================
// TYPES
// =============================================================================

interface Notification {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  priority: string | null;
  entityId: string | null;
  entityType: string | null;
  actionRequired: boolean | null;
  actionType: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date | string;
}

interface GroupedNotifications {
  today: Notification[];
  yesterday: Notification[];
  thisWeek: Notification[];
  older: Notification[];
}

// =============================================================================
// NOTIFICATION CENTER COMPONENT
// =============================================================================

export function NotificationCenter() {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  // Fetch unread count
  const { data: unreadData } = useQuery({
    ...trpc.notifications.unreadCount.queryOptions(),
    refetchInterval: 30_000,
  });

  // Fetch grouped notifications
  const { data: groupedData, isLoading } = useQuery({
    ...trpc.notifications.listGrouped.queryOptions({
      category: activeTab === "all" ? undefined : activeTab,
    }),
    enabled: open,
  });

  // Mutations
  const invalidateNotifications = () => {
    queryClient.invalidateQueries({ queryKey: [["notifications"]] });
  };

  const markAsReadMutation = useMutation({
    ...trpc.notifications.markAsRead.mutationOptions(),
    onSuccess: invalidateNotifications,
  });

  const markAllAsReadMutation = useMutation({
    ...trpc.notifications.markAllAsRead.mutationOptions(),
    onSuccess: () => {
      invalidateNotifications();
      toast.success("All notifications marked as read");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.notifications.delete.mutationOptions(),
    onSuccess: invalidateNotifications,
  });

  const deleteAllReadMutation = useMutation({
    ...trpc.notifications.deleteAllRead.mutationOptions(),
    onSuccess: () => {
      invalidateNotifications();
      toast.success("Cleared all read notifications");
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsReadMutation.mutate({ id: notification.id });
    }
    if (notification.link) {
      setOpen(false);
    }
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate({ id });
  };

  const hasNotifications =
    groupedData &&
    (groupedData.today.length > 0 ||
      groupedData.yesterday.length > 0 ||
      groupedData.thisWeek.length > 0 ||
      groupedData.older.length > 0);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button className="relative" size="icon" variant="ghost">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center p-0 text-xs"
              variant="destructive"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-[400px] flex-col p-0 sm:max-w-[400px]">
        {/* Header */}
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-semibold">
              Notifications
            </SheetTitle>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  className="h-8 px-2 text-xs"
                  disabled={markAllAsReadMutation.isPending}
                  onClick={() => markAllAsReadMutation.mutate()}
                  size="sm"
                  variant="ghost"
                >
                  {markAllAsReadMutation.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCheck className="mr-1 h-3 w-3" />
                  )}
                  Mark all read
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => deleteAllReadMutation.mutate()}
                    disabled={deleteAllReadMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear read notifications
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard/settings" onClick={() => setOpen(false)}>
                      <Settings className="mr-2 h-4 w-4" />
                      Notification settings
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </SheetHeader>

        {/* Category Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-1 flex-col"
        >
          <div className="border-b px-4">
            <TabsList className="h-10 w-full justify-start gap-1 bg-transparent p-0">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-muted rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="commitment"
                className="data-[state=active]:bg-muted rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Commitments
              </TabsTrigger>
              <TabsTrigger
                value="decision"
                className="data-[state=active]:bg-muted rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary"
              >
                <BookOpen className="mr-1 h-3 w-3" />
                Decisions
              </TabsTrigger>
              <TabsTrigger
                value="email"
                className="data-[state=active]:bg-muted rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary"
              >
                <Mail className="mr-1 h-3 w-3" />
                Email
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={activeTab} className="mt-0 flex-1">
            <ScrollArea className="h-[calc(100vh-180px)]">
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : hasNotifications ? (
                <div className="divide-y">
                  <NotificationGroup
                    title="Today"
                    notifications={groupedData.today}
                    onNotificationClick={handleNotificationClick}
                    onDelete={handleDelete}
                  />
                  <NotificationGroup
                    title="Yesterday"
                    notifications={groupedData.yesterday}
                    onNotificationClick={handleNotificationClick}
                    onDelete={handleDelete}
                  />
                  <NotificationGroup
                    title="This Week"
                    notifications={groupedData.thisWeek}
                    onNotificationClick={handleNotificationClick}
                    onDelete={handleDelete}
                  />
                  <NotificationGroup
                    title="Older"
                    notifications={groupedData.older}
                    onNotificationClick={handleNotificationClick}
                    onDelete={handleDelete}
                  />
                </div>
              ) : (
                <EmptyState />
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="border-t p-3">
          <Button
            variant="outline"
            className="w-full"
            asChild
            onClick={() => setOpen(false)}
          >
            <Link to="/dashboard/notifications">View all notifications</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// NOTIFICATION GROUP COMPONENT
// =============================================================================

interface NotificationGroupProps {
  title: string;
  notifications: Notification[];
  onNotificationClick: (notification: Notification) => void;
  onDelete: (id: string) => void;
}

function NotificationGroup({
  title,
  notifications,
  onNotificationClick,
  onDelete,
}: NotificationGroupProps) {
  if (notifications.length === 0) return null;

  return (
    <div>
      <div className="sticky top-0 z-10 bg-muted/80 px-4 py-2 backdrop-blur-sm">
        <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {title}
        </h3>
      </div>
      <div className="divide-y">
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onClick={() => onNotificationClick(notification)}
            onDelete={() => onDelete(notification.id)}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-full bg-muted p-4">
        <Bell className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mb-1 font-medium">All caught up!</h3>
      <p className="max-w-[200px] text-muted-foreground text-sm">
        You have no notifications. We'll let you know when something important
        happens.
      </p>
    </div>
  );
}

export default NotificationCenter;
