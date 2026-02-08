import { cn } from "@/lib/utils";

/**
 * Linear-style Skeleton component
 *
 * Features:
 * - Subtle pulse animation
 * - Uses muted background
 * - 4px border radius
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-[4px]", "bg-muted", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
