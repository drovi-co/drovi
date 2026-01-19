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

export function TaskLabelBadge({ label, onRemove, size = "md" }: TaskLabelBadgeProps) {
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
        className={cn("rounded-full shrink-0", dotSize)}
        style={{ backgroundColor: label.color }}
      />
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:bg-white/10 rounded-full p-0.5 -mr-0.5 transition-colors"
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

  // Fetch available labels
  const { data: labelsData } = useQuery({
    ...trpc.tasks.listLabels.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  const labels = labelsData?.labels ?? [];
  const selectedIds = new Set(selectedLabels.map((l) => l.id));

  // Add label mutation
  const addLabelMutation = useMutation({
    ...trpc.tasks.addLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      toast.error("Failed to add label");
    },
  });

  // Remove label mutation
  const removeLabelMutation = useMutation({
    ...trpc.tasks.removeLabel.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      toast.error("Failed to remove label");
    },
  });

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
      variant="ghost"
      size="sm"
      className="gap-2 h-7 text-[#858699] hover:text-[#d2d3e0] hover:bg-[#2a2b3d]"
    >
      <Tag className="h-3.5 w-3.5" />
      <span className="text-xs">Labels</span>
      {selectedLabels.length > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#2a2b3d] text-[#d2d3e0] ml-1">
          {selectedLabels.length}
        </span>
      )}
    </Button>
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          {trigger ?? defaultTrigger}
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-56 p-2 bg-[#1a1b26] border-[#2a2b3d]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-0.5">
            {labels.length === 0 ? (
              <div className="text-[13px] text-[#4c4f6b] text-center py-4">
                No labels yet. Create one below.
              </div>
            ) : (
              labels.map((label) => {
                const isSelected = selectedIds.has(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => handleToggleLabel(label)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px]",
                      "hover:bg-[#2a2b3d] transition-colors",
                      isSelected && "bg-[#2a2b3d]"
                    )}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1 text-left truncate text-[#d2d3e0]">
                      {label.name}
                    </span>
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-[#5e6ad2]" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-[#2a2b3d] mt-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-[#858699] hover:text-[#d2d3e0] hover:bg-[#2a2b3d]"
              onClick={() => {
                setOpen(false);
                setManageOpen(true);
              }}
            >
              <Settings className="h-3.5 w-3.5" />
              Manage labels
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <LabelManageDialog
        organizationId={organizationId}
        open={manageOpen}
        onOpenChange={setManageOpen}
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

function LabelManageDialog({ organizationId, open, onOpenChange }: LabelManageDialogProps) {
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
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
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
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
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
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Label deleted");
    },
    onError: () => {
      toast.error("Failed to delete label");
    },
  });

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) return;
    createMutation.mutate({
      organizationId,
      name: newLabelName.trim(),
      color: newLabelColor,
    });
  };

  const handleUpdateLabel = () => {
    if (!editingLabel || !editingLabel.name.trim()) return;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-[#1a1b26] border-[#2a2b3d]">
        <DialogHeader>
          <DialogTitle className="text-[#eeeffc]">Manage Labels</DialogTitle>
          <DialogDescription className="text-[#858699]">
            Create, edit, or delete labels for your organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Create new label */}
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-[#d2d3e0]">
              Create new label
            </label>
            <div className="flex gap-2">
              <ColorPicker
                value={newLabelColor}
                onChange={setNewLabelColor}
              />
              <Input
                placeholder="Label name..."
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateLabel();
                  }
                }}
                className="flex-1 bg-[#21232e] border-[#2a2b3d] text-[#d2d3e0] placeholder:text-[#4c4f6b] focus:border-[#5e6ad2]"
              />
              <Button
                size="sm"
                onClick={handleCreateLabel}
                disabled={!newLabelName.trim() || createMutation.isPending}
                className="bg-[#5e6ad2] hover:bg-[#6b78e3] text-white"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Existing labels */}
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-[#d2d3e0]">
              Existing labels
            </label>
            <div className="border border-[#2a2b3d] rounded-md divide-y divide-[#2a2b3d] max-h-[200px] overflow-y-auto bg-[#21232e]">
              {labels.length === 0 ? (
                <div className="text-[13px] text-[#4c4f6b] text-center py-4">
                  No labels yet
                </div>
              ) : (
                labels.map((label) => (
                  <div
                    key={label.id}
                    className="group flex items-center gap-2 px-3 py-2.5 hover:bg-[#252736] transition-colors"
                  >
                    {editingLabel?.id === label.id ? (
                      <>
                        <ColorPicker
                          value={editingLabel.color}
                          onChange={(color) =>
                            setEditingLabel({ ...editingLabel, color })
                          }
                        />
                        <Input
                          value={editingLabel.name}
                          onChange={(e) =>
                            setEditingLabel({ ...editingLabel, name: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleUpdateLabel();
                            }
                            if (e.key === "Escape") {
                              setEditingLabel(null);
                            }
                          }}
                          autoFocus
                          className="flex-1 h-7 bg-[#1a1b26] border-[#2a2b3d] text-[#d2d3e0] focus:border-[#5e6ad2]"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-[#10b981] hover:text-[#10b981] hover:bg-[#10b981]/10"
                          onClick={handleUpdateLabel}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-[#858699] hover:text-[#d2d3e0] hover:bg-[#2a2b3d]"
                          onClick={() => setEditingLabel(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: label.color }}
                        />
                        <span className="flex-1 text-[13px] text-[#d2d3e0]">
                          {label.name}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-[#858699] hover:text-[#d2d3e0] hover:bg-[#2a2b3d]"
                          onClick={() => setEditingLabel(label)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-[#f97583] hover:text-[#f97583] hover:bg-[#f97583]/10"
                          onClick={() => handleDeleteLabel(label.id)}
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
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border-[#2a2b3d] text-[#d2d3e0] hover:bg-[#2a2b3d] hover:text-[#eeeffc]"
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
          type="button"
          className="w-8 h-8 rounded-md border border-[#2a2b3d] flex items-center justify-center shrink-0 hover:border-[#3a3b4d] transition-colors"
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-2 bg-[#1a1b26] border-[#2a2b3d]"
        align="start"
      >
        <div className="grid grid-cols-6 gap-1.5">
          {LABEL_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={cn(
                "w-6 h-6 rounded-md transition-all hover:scale-110",
                color === value && "ring-2 ring-offset-2 ring-offset-[#1a1b26] ring-[#5e6ad2]"
              )}
              style={{ backgroundColor: color }}
              onClick={() => onChange(color)}
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
  if (labels.length === 0) return null;

  const displayed = labels.slice(0, max);
  const remaining = labels.length - max;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {displayed.map((label) => (
        <TaskLabelBadge key={label.id} label={label} size={size} />
      ))}
      {remaining > 0 && (
        <span className={cn(
          "text-[#4c4f6b]",
          size === "sm" ? "text-[10px]" : "text-[11px]"
        )}>
          +{remaining}
        </span>
      )}
    </div>
  );
}
