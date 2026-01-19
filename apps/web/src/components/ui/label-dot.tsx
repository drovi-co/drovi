import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Label Dot component
 *
 * Features:
 * - 8px default size (matches Figma)
 * - Color-coded for label types
 * - Can show label text alongside
 */
const labelDotVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    size: {
      xs: "size-1.5", // 6px
      sm: "size-2", // 8px
      md: "size-2.5", // 10px
      lg: "size-3", // 12px
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

export type LabelType = "bug" | "feature" | "improvement" | "documentation" | "design" | "custom";

interface LabelDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof labelDotVariants> {
  labelType?: LabelType;
  color?: string;
  label?: string;
  showLabel?: boolean;
}

const labelColors: Record<LabelType, string> = {
  bug: "#EB5757", // Red
  feature: "#5E6AD2", // Purple (Linear primary)
  improvement: "#6FCF97", // Green/Teal
  documentation: "#F2C94C", // Yellow
  design: "#BB6BD9", // Magenta
  custom: "#858699", // Default gray
};

function LabelDot({
  className,
  size,
  labelType = "custom",
  color,
  label,
  showLabel = false,
  style,
  ...props
}: LabelDotProps) {
  const dotColor = color || labelColors[labelType];

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={labelDotVariants({ size })}
        style={{ backgroundColor: dotColor, ...style }}
        data-slot="label-dot"
        {...props}
      />
      {showLabel && label && (
        <span
          className="text-[12px] font-medium"
          style={{ color: dotColor }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/**
 * Label Badge - pill-style label with dot and text
 */
interface LabelBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  labelType?: LabelType;
  color?: string;
  label: string;
}

function LabelBadge({
  className,
  labelType = "custom",
  color,
  label,
  ...props
}: LabelBadgeProps) {
  const dotColor = color || labelColors[labelType];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        "h-5 px-2 rounded-[4px]",
        "bg-muted/50",
        "text-[12px] font-medium text-foreground",
        className
      )}
      data-slot="label-badge"
      {...props}
    >
      <span
        className="size-2 rounded-full shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      {label}
    </span>
  );
}

export { LabelDot, LabelBadge, labelDotVariants, labelColors };
