// =============================================================================
// NOTIFICATION PREFERENCES PAGE
// =============================================================================
//
// Configure notification preferences for the user:
// - In-app notifications
// - Email digest settings
// - Category-specific preferences
// - Quiet hours
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  BellOff,
  Calendar,
  Clock,
  Mail,
  MessageSquare,
  Moon,
  Target,
  Zap,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/settings/notifications")({
  component: NotificationPreferencesPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

// Type for notification preferences
interface NotificationPreferences {
  inAppEnabled?: boolean;
  emailDigestEnabled?: boolean;
  emailDigestFrequency?: "daily" | "weekly" | "realtime" | "never";
  commitmentsNewEnabled?: boolean;
  commitmentsDueEnabled?: boolean;
  commitmentsOverdueEnabled?: boolean;
  decisionsNewEnabled?: boolean;
  decisionsSupersededEnabled?: boolean;
  calendarRemindersEnabled?: boolean;
  mentionsEnabled?: boolean;
  commentsEnabled?: boolean;
  assignmentsEnabled?: boolean;
  sharesEnabled?: boolean;
  teamActivityEnabled?: boolean;
  emailUrgentEnabled?: boolean;
  emailImportantEnabled?: boolean;
  syncStatusEnabled?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
}

function NotificationPreferencesPage() {
  const queryClient = useQueryClient();

  // Fetch preferences
  const { data: preferences, isLoading } = useQuery(
    trpc.notifications.getPreferences.queryOptions()
  ) as { data: NotificationPreferences | undefined; isLoading: boolean };

  // Update preferences mutation
  const updateMutation = useMutation(
    trpc.notifications.updatePreferences.mutationOptions({
      onSuccess: () => {
        toast.success("Preferences updated");
        queryClient.invalidateQueries({
          queryKey: ["notifications", "getPreferences"],
        });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update preferences");
      },
    })
  );

  const handleToggle = (key: string, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  const handleSelect = (key: string, value: string) => {
    updateMutation.mutate({ [key]: value });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            Configure how you want to be notified
          </p>
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card className="animate-pulse" key={i}>
              <CardHeader>
                <div className="h-5 w-48 rounded bg-muted" />
                <div className="h-4 w-64 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="h-10 w-full rounded bg-muted" />
                  <div className="h-10 w-full rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const prefs: NotificationPreferences = preferences ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Notifications</h1>
        <p className="text-muted-foreground">
          Configure how and when you want to be notified about activity
        </p>
      </div>

      {/* Global Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            In-App Notifications
          </CardTitle>
          <CardDescription>
            Show notifications within the Drovi app
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable notifications</Label>
              <p className="text-muted-foreground text-sm">
                Turn off to disable all in-app notifications
              </p>
            </div>
            <Switch
              checked={prefs.inAppEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("inAppEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Email Digest */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Notifications
          </CardTitle>
          <CardDescription>
            Receive email summaries of your activity and mentions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email digest</Label>
              <p className="text-muted-foreground text-sm">
                Receive periodic email summaries
              </p>
            </div>
            <Switch
              checked={prefs.emailDigestEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("emailDigestEnabled", checked)
              }
            />
          </div>

          {prefs.emailDigestEnabled && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Digest frequency</Label>
                <Select
                  onValueChange={(value) =>
                    handleSelect("emailDigestFrequency", value)
                  }
                  value={prefs.emailDigestFrequency ?? "daily"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realtime">
                      Real-time (instant emails)
                    </SelectItem>
                    <SelectItem value="daily">Daily digest</SelectItem>
                    <SelectItem value="weekly">Weekly digest</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  How often you want to receive email summaries
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Commitment Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Commitment Notifications
          </CardTitle>
          <CardDescription>
            Notifications about your commitments and deadlines
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                New commitments
                <Badge className="text-xs" variant="outline">
                  New
                </Badge>
              </Label>
              <p className="text-muted-foreground text-sm">
                When new commitments are detected in your emails
              </p>
            </div>
            <Switch
              checked={prefs.commitmentsNewEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("commitmentsNewEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                Due today
                <Badge className="text-xs" variant="secondary">
                  Important
                </Badge>
              </Label>
              <p className="text-muted-foreground text-sm">
                Reminders for commitments due today
              </p>
            </div>
            <Switch
              checked={prefs.commitmentsDueEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("commitmentsDueEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                Overdue
                <Badge className="text-xs" variant="destructive">
                  Urgent
                </Badge>
              </Label>
              <p className="text-muted-foreground text-sm">
                Alerts for overdue commitments
              </p>
            </div>
            <Switch
              checked={prefs.commitmentsOverdueEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("commitmentsOverdueEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Decision Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Decision Notifications
          </CardTitle>
          <CardDescription>
            Notifications about decisions detected in your communications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>New decisions</Label>
              <p className="text-muted-foreground text-sm">
                When new decisions are detected
              </p>
            </div>
            <Switch
              checked={prefs.decisionsNewEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("decisionsNewEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Superseded decisions</Label>
              <p className="text-muted-foreground text-sm">
                When a previous decision is changed or reversed
              </p>
            </div>
            <Switch
              checked={prefs.decisionsSupersededEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("decisionsSupersededEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Calendar Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Calendar Notifications
          </CardTitle>
          <CardDescription>
            Reminders and alerts for calendar events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Meeting reminders</Label>
              <p className="text-muted-foreground text-sm">
                Get reminded before upcoming meetings
              </p>
            </div>
            <Switch
              checked={prefs.calendarRemindersEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("calendarRemindersEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Team Collaboration Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Team Collaboration
          </CardTitle>
          <CardDescription>
            Notifications for team mentions, comments, and assignments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                @Mentions
                <Badge className="text-xs" variant="secondary">
                  Important
                </Badge>
              </Label>
              <p className="text-muted-foreground text-sm">
                When someone @mentions you in a comment or note
              </p>
            </div>
            <Switch
              checked={prefs.mentionsEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("mentionsEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Comments & replies</Label>
              <p className="text-muted-foreground text-sm">
                When someone comments on items you follow or own
              </p>
            </div>
            <Switch
              checked={prefs.commentsEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("commentsEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Assignments</Label>
              <p className="text-muted-foreground text-sm">
                When a conversation, task, or commitment is assigned to you
              </p>
            </div>
            <Switch
              checked={prefs.assignmentsEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("assignmentsEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Shared with me</Label>
              <p className="text-muted-foreground text-sm">
                When someone shares an item with you
              </p>
            </div>
            <Switch
              checked={prefs.sharesEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("sharesEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Team activity</Label>
              <p className="text-muted-foreground text-sm">
                Daily summary of your team's activity
              </p>
            </div>
            <Switch
              checked={prefs.teamActivityEnabled ?? false}
              onCheckedChange={(checked) =>
                handleToggle("teamActivityEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Email Priority Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Priority Notifications
          </CardTitle>
          <CardDescription>
            Notifications for high-priority emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                Urgent emails
                <Badge className="text-xs" variant="destructive">
                  High
                </Badge>
              </Label>
              <p className="text-muted-foreground text-sm">
                Immediate notification for urgent emails
              </p>
            </div>
            <Switch
              checked={prefs.emailUrgentEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("emailUrgentEnabled", checked)
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Important emails</Label>
              <p className="text-muted-foreground text-sm">
                Notification for emails marked as important
              </p>
            </div>
            <Switch
              checked={prefs.emailImportantEnabled ?? true}
              onCheckedChange={(checked) =>
                handleToggle("emailImportantEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Moon className="h-5 w-5" />
            Quiet Hours
          </CardTitle>
          <CardDescription>
            Pause notifications during specific times
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable quiet hours</Label>
              <p className="text-muted-foreground text-sm">
                Pause non-urgent notifications during set times
              </p>
            </div>
            <Switch
              checked={prefs.quietHoursEnabled ?? false}
              onCheckedChange={(checked) =>
                handleToggle("quietHoursEnabled", checked)
              }
            />
          </div>

          {prefs.quietHoursEnabled && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Start time
                  </Label>
                  <Input
                    onChange={(e) =>
                      handleSelect("quietHoursStart", e.target.value)
                    }
                    type="time"
                    value={prefs.quietHoursStart ?? "22:00"}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    End time
                  </Label>
                  <Input
                    onChange={(e) =>
                      handleSelect("quietHoursEnd", e.target.value)
                    }
                    type="time"
                    value={prefs.quietHoursEnd ?? "08:00"}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select
                  onValueChange={(value) =>
                    handleSelect("quietHoursTimezone", value)
                  }
                  value={
                    prefs.quietHoursTimezone ??
                    Intl.DateTimeFormat().resolvedOptions().timeZone
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">
                      Eastern Time (ET)
                    </SelectItem>
                    <SelectItem value="America/Chicago">
                      Central Time (CT)
                    </SelectItem>
                    <SelectItem value="America/Denver">
                      Mountain Time (MT)
                    </SelectItem>
                    <SelectItem value="America/Los_Angeles">
                      Pacific Time (PT)
                    </SelectItem>
                    <SelectItem value="Europe/London">
                      London (GMT/BST)
                    </SelectItem>
                    <SelectItem value="Europe/Paris">
                      Paris (CET/CEST)
                    </SelectItem>
                    <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                    <SelectItem value="Asia/Shanghai">
                      Shanghai (CST)
                    </SelectItem>
                    <SelectItem value="Australia/Sydney">
                      Sydney (AEST)
                    </SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* System Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5 text-muted-foreground" />
            System Notifications
          </CardTitle>
          <CardDescription>
            Technical notifications about sync status and errors
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Sync status updates</Label>
              <p className="text-muted-foreground text-sm">
                Notifications about email sync status and errors
              </p>
            </div>
            <Switch
              checked={prefs.syncStatusEnabled ?? false}
              onCheckedChange={(checked) =>
                handleToggle("syncStatusEnabled", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Reset Preferences */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Reset to defaults</Label>
              <p className="text-muted-foreground text-sm">
                Reset all notification preferences to their default values
              </p>
            </div>
            <Button
              onClick={() => {
                updateMutation.mutate({
                  inAppEnabled: true,
                  emailDigestEnabled: true,
                  emailDigestFrequency: "daily",
                  commitmentsNewEnabled: true,
                  commitmentsDueEnabled: true,
                  commitmentsOverdueEnabled: true,
                  decisionsNewEnabled: true,
                  decisionsSupersededEnabled: true,
                  calendarRemindersEnabled: true,
                  emailUrgentEnabled: true,
                  emailImportantEnabled: true,
                  syncStatusEnabled: false,
                  quietHoursEnabled: false,
                  quietHoursStart: "22:00",
                  quietHoursEnd: "08:00",
                });
              }}
              variant="outline"
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
