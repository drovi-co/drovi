import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Kbd,
} from "@memorystack/ui-core/command";
import { Dialog, DialogContent } from "@memorystack/ui-core/dialog";
import { cn } from "@memorystack/ui-core/utils";
import type { ReactNode } from "react";
import { useEffect } from "react";

export interface CommandBarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  showCloseButton?: boolean;
}

export function isCommandBarShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
}

export function useCommandBarShortcut(
  setOpen: (open: boolean) => void,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCommandBarShortcut(event)) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, setOpen]);
}

export function CommandBarDialog({
  open,
  onOpenChange,
  children,
  className,
  contentClassName,
  showCloseButton = true,
}: CommandBarDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn("overflow-hidden p-0 sm:max-w-[840px]", className)}
        showCloseButton={showCloseButton}
      >
        <div className={cn("max-h-[72vh]", contentClassName)}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Kbd,
};
