import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Loader2, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { queryClient, trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface AISettingsForm {
  title: string;
  company: string;
  department: string;
  signature: string;
  preferredTone: "formal" | "casual" | "professional" | "friendly" | "";
  signOff: string;
  phone: string;
  linkedinUrl: string;
  calendarBookingLink: string;
  workingHours: {
    timezone: string;
    start: string;
    end: string;
    workDays: number[];
  };
}

const DEFAULT_SETTINGS: AISettingsForm = {
  title: "",
  company: "",
  department: "",
  signature: "",
  preferredTone: "",
  signOff: "Best regards",
  phone: "",
  linkedinUrl: "",
  calendarBookingLink: "",
  workingHours: {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    start: "09:00",
    end: "17:00",
    workDays: [1, 2, 3, 4, 5], // Monday to Friday
  },
};

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "formal", label: "Formal" },
  { value: "friendly", label: "Friendly" },
  { value: "casual", label: "Casual" },
];

const SIGN_OFF_OPTIONS = [
  "Best regards",
  "Best",
  "Thanks",
  "Thank you",
  "Regards",
  "Sincerely",
  "Cheers",
  "Warm regards",
];

const WORK_DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

// =============================================================================
// COMPONENT
// =============================================================================

export function AISettings() {
  const trpcClient = trpc;
  const [settings, setSettings] = useState<AISettingsForm>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current settings
  const { data: currentSettings, isLoading } = useQuery({
    ...trpcClient.user.getAISettings.queryOptions(),
  });

  // Update mutation
  const updateMutation = useMutation(
    trpcClient.user.updateAISettings.mutationOptions({
      onSuccess: () => {
        toast.success("AI settings saved");
        setHasChanges(false);
        queryClient.invalidateQueries({ queryKey: ["user", "getAISettings"] });
      },
      onError: (error) => {
        toast.error(`Failed to save settings: ${error.message}`);
      },
    })
  );

  // Initialize form with fetched data
  useEffect(() => {
    if (currentSettings) {
      setSettings({
        title: currentSettings.title ?? "",
        company: currentSettings.company ?? "",
        department: currentSettings.department ?? "",
        signature: currentSettings.signature ?? "",
        preferredTone: currentSettings.preferredTone ?? "",
        signOff: currentSettings.signOff ?? "Best regards",
        phone: currentSettings.phone ?? "",
        linkedinUrl: currentSettings.linkedinUrl ?? "",
        calendarBookingLink: currentSettings.calendarBookingLink ?? "",
        workingHours:
          currentSettings.workingHours ?? DEFAULT_SETTINGS.workingHours,
      });
    }
  }, [currentSettings]);

  // Update field helper
  const updateField = <K extends keyof AISettingsForm>(
    field: K,
    value: AISettingsForm[K]
  ) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  // Handle save
  const handleSave = () => {
    const toSave = {
      ...settings,
      preferredTone: settings.preferredTone || undefined,
      linkedinUrl: settings.linkedinUrl || undefined,
      calendarBookingLink: settings.calendarBookingLink || undefined,
    };
    updateMutation.mutate(toSave);
  };

  // Generate signature from current info
  const generateSignature = () => {
    const parts: string[] = [];

    if (currentSettings?.userName) {
      parts.push(currentSettings.userName);
    }
    if (settings.title) {
      parts.push(settings.title);
    }
    if (settings.company) {
      parts.push(settings.company);
    }
    if (settings.phone) {
      parts.push(settings.phone);
    }
    if (currentSettings?.userEmail) {
      parts.push(currentSettings.userEmail);
    }
    if (settings.linkedinUrl) {
      parts.push(settings.linkedinUrl);
    }

    const signature = parts.join("\n");
    updateField("signature", signature);
  };

  // Toggle work day
  const toggleWorkDay = (day: number) => {
    const current = settings.workingHours.workDays;
    const newDays = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort();
    updateField("workingHours", {
      ...settings.workingHours,
      workDays: newDays,
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <CardTitle>AI Assistant Settings</CardTitle>
        </div>
        <CardDescription>
          Configure how AI generates email drafts. These settings help
          personalize AI-generated content with your information.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Professional Info */}
        <div className="space-y-4">
          <h3 className="font-medium text-sm">Professional Information</h3>
          <p className="text-muted-foreground text-xs">
            This information is used to replace placeholders like [Your Name],
            [Your Title], etc.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Job Title</Label>
              <Input
                id="title"
                onChange={(e) => updateField("title", e.target.value)}
                placeholder="e.g., Software Engineer"
                value={settings.title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                onChange={(e) => updateField("company", e.target.value)}
                placeholder="e.g., Acme Inc."
                value={settings.company}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                onChange={(e) => updateField("department", e.target.value)}
                placeholder="e.g., Engineering"
                value={settings.department}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="e.g., +1 (555) 123-4567"
                value={settings.phone}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Links */}
        <div className="space-y-4">
          <h3 className="font-medium text-sm">Links</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
              <Input
                id="linkedinUrl"
                onChange={(e) => updateField("linkedinUrl", e.target.value)}
                placeholder="https://linkedin.com/in/yourprofile"
                type="url"
                value={settings.linkedinUrl}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calendarBookingLink">Calendar Booking Link</Label>
              <Input
                id="calendarBookingLink"
                onChange={(e) =>
                  updateField("calendarBookingLink", e.target.value)
                }
                placeholder="https://calendly.com/yourname"
                type="url"
                value={settings.calendarBookingLink}
              />
              <p className="text-muted-foreground text-xs">
                Used when AI suggests scheduling a meeting
              </p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Writing Style */}
        <div className="space-y-4">
          <h3 className="font-medium text-sm">Writing Style</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="preferredTone">Preferred Tone</Label>
              <Select
                onValueChange={(value) =>
                  updateField(
                    "preferredTone",
                    value as AISettingsForm["preferredTone"]
                  )
                }
                value={settings.preferredTone}
              >
                <SelectTrigger id="preferredTone">
                  <SelectValue placeholder="Select tone" />
                </SelectTrigger>
                <SelectContent>
                  {TONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signOff">Sign-off</Label>
              <Select
                onValueChange={(value) => updateField("signOff", value)}
                value={settings.signOff}
              >
                <SelectTrigger id="signOff">
                  <SelectValue placeholder="Select sign-off" />
                </SelectTrigger>
                <SelectContent>
                  {SIGN_OFF_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* Signature */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm">Email Signature</h3>
              <p className="text-muted-foreground text-xs">
                This signature will be added to AI-generated emails
              </p>
            </div>
            <Button
              className="gap-1"
              onClick={generateSignature}
              size="sm"
              variant="outline"
            >
              <Sparkles className="h-3 w-3" />
              Generate
            </Button>
          </div>

          <Textarea
            className="font-mono text-sm"
            onChange={(e) => updateField("signature", e.target.value)}
            placeholder="Enter your email signature..."
            rows={5}
            value={settings.signature}
          />
        </div>

        <Separator />

        {/* Working Hours */}
        <div className="space-y-4">
          <h3 className="font-medium text-sm">Working Hours</h3>
          <p className="text-muted-foreground text-xs">
            Used when AI suggests meeting times or availability
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                onChange={(e) =>
                  updateField("workingHours", {
                    ...settings.workingHours,
                    start: e.target.value,
                  })
                }
                type="time"
                value={settings.workingHours.start}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                onChange={(e) =>
                  updateField("workingHours", {
                    ...settings.workingHours,
                    end: e.target.value,
                  })
                }
                type="time"
                value={settings.workingHours.end}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                onChange={(e) =>
                  updateField("workingHours", {
                    ...settings.workingHours,
                    timezone: e.target.value,
                  })
                }
                placeholder="America/New_York"
                value={settings.workingHours.timezone}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Work Days</Label>
            <div className="flex flex-wrap gap-2">
              {WORK_DAYS.map((day) => (
                <Button
                  className="w-12"
                  key={day.value}
                  onClick={() => toggleWorkDay(day.value)}
                  size="sm"
                  type="button"
                  variant={
                    settings.workingHours.workDays.includes(day.value)
                      ? "default"
                      : "outline"
                  }
                >
                  {day.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <Button
            className="gap-2"
            disabled={!hasChanges || updateMutation.isPending}
            onClick={handleSave}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
