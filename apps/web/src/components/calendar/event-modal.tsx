"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addHours,
  format,
  isBefore,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";
import {
  Calendar,
  Check,
  ExternalLink,
  Loader2,
  MapPin,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
      <Dialog onOpenChange={onOpenChange} open={open}>
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

          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                autoFocus
                id="title"
                onChange={(e) => updateField("title", e.target.value)}
                placeholder="Add title"
                value={form.title}
              />
            </div>

            {/* All Day Toggle */}
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2" htmlFor="all-day">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                All day
              </Label>
              <Switch
                checked={form.isAllDay}
                id="all-day"
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
                    onChange={(e) => updateField("startDate", e.target.value)}
                    type="date"
                    value={form.startDate}
                  />
                </div>
                {!form.isAllDay && (
                  <div className="space-y-2">
                    <Label htmlFor="start-time">Time</Label>
                    <Input
                      id="start-time"
                      onChange={(e) => updateField("startTime", e.target.value)}
                      type="time"
                      value={form.startTime}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="end-date">End</Label>
                  <Input
                    id="end-date"
                    onChange={(e) => updateField("endDate", e.target.value)}
                    type="date"
                    value={form.endDate}
                  />
                </div>
                {!form.isAllDay && (
                  <div className="space-y-2">
                    <Label htmlFor="end-time">Time</Label>
                    <Input
                      id="end-time"
                      onChange={(e) => updateField("endTime", e.target.value)}
                      type="time"
                      value={form.endTime}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2" htmlFor="location">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Location
              </Label>
              <Input
                id="location"
                onChange={(e) => updateField("location", e.target.value)}
                placeholder="Add location"
                value={form.location}
              />
            </div>

            {/* Video Conference */}
            <div className="flex items-center justify-between">
              <Label
                className="flex items-center gap-2"
                htmlFor="add-conference"
              >
                <Video className="h-4 w-4 text-muted-foreground" />
                Add video call
              </Label>
              <Switch
                checked={form.addConference}
                id="add-conference"
                onCheckedChange={(checked) =>
                  updateField("addConference", checked)
                }
              />
            </div>

            {/* Existing conference link */}
            {isEditing && event?.conferenceData && (
              <div className="rounded-lg bg-muted/50 p-3">
                <a
                  className="flex items-center gap-2 text-blue-600 text-sm hover:underline"
                  href={event.conferenceData.entryPoints[0]?.uri}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Video className="h-4 w-4" />
                  Join video call
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Attendees */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2" htmlFor="attendees">
                <Users className="h-4 w-4 text-muted-foreground" />
                Attendees
              </Label>
              <Input
                id="attendees"
                onChange={(e) => updateField("attendees", e.target.value)}
                placeholder="Add emails, separated by commas"
                value={form.attendees}
              />
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                onValueChange={(value: "default" | "public" | "private") =>
                  updateField("visibility", value)
                }
                value={form.visibility}
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
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Add description"
                rows={3}
                value={form.description}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              {isEditing && (
                <Button
                  className="mr-auto"
                  disabled={isLoading}
                  onClick={() => setShowDeleteConfirm(true)}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              )}
              <Button
                disabled={isLoading}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={isLoading} type="submit">
                {isLoading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1 h-4 w-4" />
                )}
                {isEditing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog onOpenChange={setShowDeleteConfirm} open={showDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{event?.title}&rdquo;? This
              action cannot be undone.
              {event?.attendees && event.attendees.length > 1 && (
                <span className="mt-2 block">
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
