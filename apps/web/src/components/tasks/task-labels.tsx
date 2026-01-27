// =============================================================================
// TASK LABELS COMPONENT
// =============================================================================
//
// Comprehensive label management for tasks including:
// - Label picker for assigning labels to tasks
// - Label management dialog (create, edit, delete)
// - Label badge display
//
// Linear-style design with dark theme colors.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Settings, Tag, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import type { TaskLabel } from "./task-types";

// =============================================================================
// CONSTANTS
// =============================================================================

const LABEL_COLORS = [
  "#EF4444", // red-500
  "#F97316", // orange-500
  "#F59E0B", // amber-500
  "#EAB308", // yellow-500
  "#84CC16", // lime-500
  "#22C55E", // green-500
  "#10B981", // emerald-500
  "#14B8A6", // teal-500
  "#06B6D4", // cyan-500
  "#0EA5E9", // sky-500
  "#3B82F6", // blue-500
  "#6366F1", // indigo-500
  "#8B5CF6", // violet-500
  "#A855F7", // purple-500
  "#D946EF", // fuchsia-500
  "#EC4899", // pink-500
  "#6B7280", // gray-500
];

// =============================================================================
// LABEL BADGE (Linear-style)
// =============================================================================

interface TaskLabelBadgeProps {
  label: TaskLabel;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export function TaskLabelBadge({
  label,
  onRemove,
  size = "md",
}: TaskLabelBadgeProps) {
  const textSize = size === "sm" ? "text-[10px]" : "text-[11px]";
  const padding = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";
  const dotSize = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
        textSize,
        padding
      )}
      style={{
        backgroundColor: `${label.color}15`,
        color: label.color,
      }}
    >
      <span
        className={cn("shrink-0 rounded-full", dotSize)}
        style={{ backgroundColor: label.color }}
      />
      {label.name}
      {onRemove && (
        <button
          className="-mr-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// =============================================================================
// LABEL PICKER (For assigning labels to a task) - Linear-style
// =============================================================================

interface TaskLabelPickerProps {
  taskId: string;
  organizationId: string;
  selectedLabels: TaskLabel[];
  onLabelsChange?: (labels: TaskLabel[]) => void;
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
}

export function TaskLabelPicker({
  taskId,
  organizationId,
  selectedLabels,
  trigger,
  align = "start",
}: TaskLabelPickerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [showCreateInput, setShowCreateInput] = useState(false);

  // Fetch available labels
  const { data: labelsData } = useQuery({
    ...trpc.tasks.listLabels.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  const labels = labelsData?.labels ?? [];
  const selectedIds = new Set(selectedLabels.map((l) => l.id));

  // Create label mutation (inline creation)
  const createLabelMutation = useMutation({
    ...trpc.tasks.createLabel.mutationOptions(),
    onSuccess: (newLabel) => {
      // Invalidate labels list to show new label
      queryClient.invalidateQueries({ queryKey: [["tasks", "listLabels"]] });
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
      setNewLabelName("");
      setShowCreateInput(false);
      toast.success("Label created");
      // Automatically add the new label to the task
      if (newLabel?.id) {
        addLabelMutation.mutate({
          organizationId,
          taskId,
          labelId: newLabel.id,
        });
      }
    },
    onError: () => {
      toast.error("Failed to create label");
    },
  });

  // Add label mutation
  const addLabelMutation = useMutation({
    ...trpc.tasks.addLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
    },
    onError: () => {
      toast.error("Failed to add label");
    },
  });

  // Remove label mutation
  const removeLabelMutation = useMutation({
    ...trpc.tasks.removeLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
    },
    onError: () => {
      toast.error("Failed to remove label");
    },
  });

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) {
      return;
    }
    // Pick a random color from the palette
    const randomColor =
      LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)]!;
    createLabelMutation.mutate({
      organizationId,
      name: newLabelName.trim(),
      color: randomColor,
    });
  };

  const handleToggleLabel = (label: TaskLabel) => {
    if (selectedIds.has(label.id)) {
      removeLabelMutation.mutate({
        organizationId,
        taskId,
        labelId: label.id,
      });
    } else {
      addLabelMutation.mutate({
        organizationId,
        taskId,
        labelId: label.id,
      });
    }
  };

  const defaultTrigger = (
    <Button
      className="h-7 gap-2 text-muted-foreground hover:bg-accent hover:text-foreground"
      size="sm"
      variant="ghost"
    >
      <Tag className="h-3.5 w-3.5" />
      <span className="text-xs">Labels</span>
      {selectedLabels.length > 0 && (
        <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
          {selectedLabels.length}
        </span>
      )}
    </Button>
  );

  return (
    <>
      <Popover
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) {
            // Reset create input state when closing popover
            setShowCreateInput(false);
            setNewLabelName("");
          }
        }}
        open={open}
      >
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          {trigger ?? defaultTrigger}
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-56 border-border bg-card p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-0.5">
            {labels.length === 0 ? (
              <div className="py-4 text-center text-[13px] text-muted-foreground">
                No labels yet. Create one below.
              </div>
            ) : (
              labels.map((label) => {
                const isSelected = selectedIds.has(label.id);
                return (
                  <button
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]",
                      "transition-colors hover:bg-accent",
                      isSelected && "bg-muted"
                    )}
                    key={label.id}
                    onClick={() => handleToggleLabel(label)}
                    type="button"
                  >
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1 truncate text-left text-foreground">
                      {label.name}
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-secondary" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Inline create label */}
          <div className="mt-2 space-y-2 border-border border-t pt-2">
            {showCreateInput ? (
              <div className="flex gap-1.5">
                <Input
                  autoFocus
                  className="h-7 flex-1 border-border bg-muted text-[13px] text-foreground placeholder:text-muted-foreground focus:border-secondary"
                  onChange={(e) => setNewLabelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateLabel();
                    }
                    if (e.key === "Escape") {
                      setShowCreateInput(false);
                      setNewLabelName("");
                    }
                  }}
                  placeholder="Label name..."
                  value={newLabelName}
                />
                <Button
                  className="h-7 bg-secondary px-2 text-white hover:bg-secondary-hover"
                  disabled={
                    !newLabelName.trim() || createLabelMutation.isPending
                  }
                  onClick={handleCreateLabel}
                  size="sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  className="h-7 px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    setShowCreateInput(false);
                    setNewLabelName("");
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                className="w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setShowCreateInput(true)}
                size="sm"
                variant="ghost"
              >
                <Plus className="h-3.5 w-3.5" />
                Create new label
              </Button>
            )}
            <Button
              className="w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setManageOpen(true);
              }}
              size="sm"
              variant="ghost"
            >
              <Settings className="h-3.5 w-3.5" />
              Manage labels
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <LabelManageDialog
        onOpenChange={setManageOpen}
        open={manageOpen}
        organizationId={organizationId}
      />
    </>
  );
}

// =============================================================================
// LABEL MANAGE DIALOG - Linear-style
// =============================================================================

interface LabelManageDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function LabelManageDialog({
  organizationId,
  open,
  onOpenChange,
}: LabelManageDialogProps) {
  const queryClient = useQueryClient();
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[10]!); // blue
  const [editingLabel, setEditingLabel] = useState<TaskLabel | null>(null);

  // Fetch labels
  const { data: labelsData } = useQuery({
    ...trpc.tasks.listLabels.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  const labels = labelsData?.labels ?? [];

  // Create label mutation (correct API path)
  const createMutation = useMutation({
    ...trpc.tasks.createLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [["tasks", "listLabels"]] });
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
      setNewLabelName("");
      toast.success("Label created");
    },
    onError: () => {
      toast.error("Failed to create label");
    },
  });

  // Update label mutation (correct API path)
  const updateMutation = useMutation({
    ...trpc.tasks.updateLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [["tasks", "listLabels"]] });
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
      setEditingLabel(null);
      toast.success("Label updated");
    },
    onError: () => {
      toast.error("Failed to update label");
    },
  });

  // Delete label mutation (correct API path)
  const deleteMutation = useMutation({
    ...trpc.tasks.deleteLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [["tasks", "listLabels"]] });
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
      toast.success("Label deleted");
    },
    onError: () => {
      toast.error("Failed to delete label");
    },
  });

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) {
      return;
    }
    createMutation.mutate({
      organizationId,
      name: newLabelName.trim(),
      color: newLabelColor,
    });
  };

  const handleUpdateLabel = () => {
    if (!editingLabel?.name.trim()) {
      return;
    }
    updateMutation.mutate({
      organizationId,
      labelId: editingLabel.id,
      name: editingLabel.name.trim(),
      color: editingLabel.color,
    });
  };

  const handleDeleteLabel = (labelId: string) => {
    deleteMutation.mutate({
      organizationId,
      labelId,
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="border-border bg-card sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">Manage Labels</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create, edit, or delete labels for your organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Create new label */}
          <div className="space-y-2">
            <label className="font-medium text-[13px] text-foreground">
              Create new label
            </label>
            <div className="flex gap-2">
              <ColorPicker onChange={setNewLabelColor} value={newLabelColor} />
              <Input
                className="flex-1 border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-secondary"
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateLabel();
                  }
                }}
                placeholder="Label name..."
                value={newLabelName}
              />
              <Button
                className="bg-secondary text-white hover:bg-secondary-hover"
                disabled={!newLabelName.trim() || createMutation.isPending}
                onClick={handleCreateLabel}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Existing labels */}
          <div className="space-y-2">
            <label className="font-medium text-[13px] text-foreground">
              Existing labels
            </label>
            <div className="max-h-[200px] divide-y divide-border overflow-y-auto rounded-md border border-border bg-muted">
              {labels.length === 0 ? (
                <div className="py-4 text-center text-[13px] text-muted-foreground">
                  No labels yet
                </div>
              ) : (
                labels.map((label) => (
                  <div
                    className="group flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-accent"
                    key={label.id}
                  >
                    {editingLabel?.id === label.id ? (
                      <>
                        <ColorPicker
                          onChange={(color) =>
                            setEditingLabel({ ...editingLabel, color })
                          }
                          value={editingLabel.color}
                        />
                        <Input
                          autoFocus
                          className="h-7 flex-1 border-border bg-card text-foreground focus:border-secondary"
                          onChange={(e) =>
                            setEditingLabel({
                              ...editingLabel,
                              name: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleUpdateLabel();
                            }
                            if (e.key === "Escape") {
                              setEditingLabel(null);
                            }
                          }}
                          value={editingLabel.name}
                        />
                        <Button
                          className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
                          onClick={handleUpdateLabel}
                          size="icon"
                          variant="ghost"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={() => setEditingLabel(null)}
                          size="icon"
                          variant="ghost"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="flex-1 text-[13px] text-foreground">
                          {label.name}
                        </span>
                        <Button
                          className="h-7 w-7 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          onClick={() => setEditingLabel(label)}
                          size="icon"
                          variant="ghost"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          className="h-7 w-7 text-destructive opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          onClick={() => handleDeleteLabel(label.id)}
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            className="border-border bg-transparent text-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// COLOR PICKER - Linear-style
// =============================================================================

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border transition-colors hover:border-border"
          style={{ backgroundColor: value }}
          type="button"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto border-border bg-card p-2"
      >
        <div className="grid grid-cols-6 gap-1.5">
          {LABEL_COLORS.map((color) => (
            <button
              className={cn(
                "h-6 w-6 rounded-md transition-all hover:scale-110",
                color === value &&
                  "ring-2 ring-secondary ring-offset-2 ring-offset-card"
              )}
              key={color}
              onClick={() => onChange(color)}
              style={{ backgroundColor: color }}
              type="button"
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// TASK LABELS DISPLAY (Read-only display of labels) - Linear-style
// =============================================================================

interface TaskLabelsDisplayProps {
  labels: TaskLabel[];
  max?: number;
  size?: "sm" | "md";
  className?: string;
}

export function TaskLabelsDisplay({
  labels,
  max = 3,
  size = "sm",
  className,
}: TaskLabelsDisplayProps) {
  if (labels.length === 0) {
    return null;
  }

  const displayed = labels.slice(0, max);
  const remaining = labels.length - max;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {displayed.map((label) => (
        <TaskLabelBadge key={label.id} label={label} size={size} />
      ))}
      {remaining > 0 && (
        <span
          className={cn(
            "text-muted-foreground",
            size === "sm" ? "text-[10px]" : "text-[11px]"
          )}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}
