"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format,
  addHours,
  setHours,
  setMinutes,
  startOfDay,
  isBefore,
} from "date-fns";
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Video,
  Trash2,
  Loader2,
  Check,
  X,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTRPC } from "@/utils/trpc";
import type { CalendarEvent } from "./types";

// =============================================================================
// TYPES
// =============================================================================

interface EventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  defaultDate?: Date;
  defaultHour?: number;
  accountId: string;
}

interface FormData {
  title: string;
  description: string;
  location: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  isAllDay: boolean;
  addConference: boolean;
  visibility: "default" | "public" | "private";
  attendees: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDateForInput(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatTimeForInput(date: Date): string {
  return format(date, "HH:mm");
}

function parseDateTimeInputs(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

function getDefaultFormData(
  event: CalendarEvent | null,
  defaultDate?: Date,
  defaultHour?: number
): FormData {
  if (event) {
    return {
      title: event.title,
      description: event.description || "",
      location: event.location || "",
      startDate: formatDateForInput(event.start),
      startTime: formatTimeForInput(event.start),
      endDate: formatDateForInput(event.end),
      endTime: formatTimeForInput(event.end),
      isAllDay: event.isAllDay,
      addConference: !!event.conferenceData,
      visibility: event.visibility,
      attendees: event.attendees
        .filter((a) => !a.self)
        .map((a) => a.email)
        .join(", "),
    };
  }

  const start = defaultDate
    ? defaultHour !== undefined
      ? setMinutes(setHours(defaultDate, defaultHour), 0)
      : defaultDate
    : setMinutes(setHours(new Date(), new Date().getHours() + 1), 0);

  const end = addHours(start, 1);

  return {
    title: "",
    description: "",
    location: "",
    startDate: formatDateForInput(start),
    startTime: formatTimeForInput(start),
    endDate: formatDateForInput(end),
    endTime: formatTimeForInput(end),
    isAllDay: false,
    addConference: false,
    visibility: "default",
    attendees: "",
  };
}

// =============================================================================
// EVENT MODAL COMPONENT
// =============================================================================

export function EventModal({
  open,
  onOpenChange,
  event,
  defaultDate,
  defaultHour,
  accountId,
}: EventModalProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const isEditing = !!event;

  const [form, setForm] = useState<FormData>(() =>
    getDefaultFormData(event, defaultDate, defaultHour)
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset form when modal opens with new data
  useEffect(() => {
    if (open) {
      setForm(getDefaultFormData(event, defaultDate, defaultHour));
    }
  }, [open, event, defaultDate, defaultHour]);

  // Invalidate all calendar queries (tRPC uses nested array format)
  const invalidateCalendarQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        // tRPC query keys are like [["calendar", "listEvents"], { input }]
        return Array.isArray(key[0]) && key[0][0] === "calendar";
      },
    });
  };

  // Create event mutation
  const createMutation = useMutation(
    trpc.calendar.createEvent.mutationOptions({
      onSuccess: () => {
        toast.success("Event created");
        invalidateCalendarQueries();
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(`Failed to create event: ${error.message}`);
      },
    })
  );

  // Update event mutation
  const updateMutation = useMutation(
    trpc.calendar.updateEvent.mutationOptions({
      onSuccess: () => {
        toast.success("Event updated");
        invalidateCalendarQueries();
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error(`Failed to update event: ${error.message}`);
      },
    })
  );

  // Delete event mutation
  const deleteMutation = useMutation(
    trpc.calendar.deleteEvent.mutationOptions({
      onSuccess: () => {
        toast.success("Event deleted");
        invalidateCalendarQueries();
        onOpenChange(false);
        setShowDeleteConfirm(false);
      },
      onError: (error) => {
        toast.error(`Failed to delete event: ${error.message}`);
      },
    })
  );

  // Form handlers
  const updateField = <K extends keyof FormData>(
    field: K,
    value: FormData[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Submit handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }

    const startDateTime = form.isAllDay
      ? startOfDay(new Date(form.startDate))
      : parseDateTimeInputs(form.startDate, form.startTime);

    const endDateTime = form.isAllDay
      ? startOfDay(new Date(form.endDate))
      : parseDateTimeInputs(form.endDate, form.endTime);

    if (isBefore(endDateTime, startDateTime)) {
      toast.error("End time must be after start time");
      return;
    }

    // Parse attendees
    const attendees = form.attendees
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0)
      .map((email) => ({ email }));

    const payload = {
      accountId,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      location: form.location.trim() || undefined,
      start: startDateTime,
      end: endDateTime,
      isAllDay: form.isAllDay,
      addConference: form.addConference,
      visibility: form.visibility,
      attendees: attendees.length > 0 ? attendees : undefined,
    };

    if (isEditing && event) {
      updateMutation.mutate({
        ...payload,
        eventId: event.id,
        calendarId: event.calendarId,
        sendUpdates: true,
      });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Delete handler
  const handleDelete = () => {
    if (event) {
      deleteMutation.mutate({
        accountId,
        calendarId: event.calendarId,
        eventId: event.id,
        sendUpdates: true,
      });
    }
  };

  const isLoading =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Edit Event" : "Create Event"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the event details below"
                : "Add a new event to your calendar"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => updateField("title", e.target.value)}
                placeholder="Add title"
                autoFocus
              />
            </div>

            {/* All Day Toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="all-day" className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                All day
              </Label>
              <Switch
                id="all-day"
                checked={form.isAllDay}
                onCheckedChange={(checked) => updateField("isAllDay", checked)}
              />
            </div>

            {/* Date & Time */}
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => updateField("startDate", e.target.value)}
                  />
                </div>
                {!form.isAllDay && (
                  <div className="space-y-2">
                    <Label htmlFor="start-time">Time</Label>
                    <Input
                      id="start-time"
                      type="time"
                      value={form.startTime}
                      onChange={(e) => updateField("startTime", e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="end-date">End</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={form.endDate}
                    onChange={(e) => updateField("endDate", e.target.value)}
                  />
                </div>
                {!form.isAllDay && (
                  <div className="space-y-2">
                    <Label htmlFor="end-time">Time</Label>
                    <Input
                      id="end-time"
                      type="time"
                      value={form.endTime}
                      onChange={(e) => updateField("endTime", e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location" className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Location
              </Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => updateField("location", e.target.value)}
                placeholder="Add location"
              />
            </div>

            {/* Video Conference */}
            <div className="flex items-center justify-between">
              <Label
                htmlFor="add-conference"
                className="flex items-center gap-2"
              >
                <Video className="h-4 w-4 text-muted-foreground" />
                Add video call
              </Label>
              <Switch
                id="add-conference"
                checked={form.addConference}
                onCheckedChange={(checked) =>
                  updateField("addConference", checked)
                }
              />
            </div>

            {/* Existing conference link */}
            {isEditing && event?.conferenceData && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <a
                  href={event.conferenceData.entryPoints[0]?.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
                >
                  <Video className="h-4 w-4" />
                  Join video call
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Attendees */}
            <div className="space-y-2">
              <Label htmlFor="attendees" className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Attendees
              </Label>
              <Input
                id="attendees"
                value={form.attendees}
                onChange={(e) => updateField("attendees", e.target.value)}
                placeholder="Add emails, separated by commas"
              />
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                value={form.visibility}
                onValueChange={(value: "default" | "public" | "private") =>
                  updateField("visibility", value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Add description"
                rows={3}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              {isEditing && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isLoading}
                  className="mr-auto"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                {isEditing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{event?.title}&rdquo;? This
              action cannot be undone.
              {event?.attendees && event.attendees.length > 1 && (
                <span className="block mt-2">
                  Attendees will be notified of the cancellation.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
