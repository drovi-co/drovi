import { Button } from "@memorystack/ui-core/button";
import { Progress } from "@memorystack/ui-core/progress";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface OnboardingStep {
  id: string;
  label: string;
  completed: boolean;
  action?: () => void;
  actionLabel?: string;
}

interface OnboardingWidgetProps {
  steps: OnboardingStep[];
  onDismiss?: () => void;
}

export function OnboardingWidget({ steps, onDismiss }: OnboardingWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const completedCount = steps.filter((s) => s.completed).length;
  const progress = (completedCount / steps.length) * 100;
  const allCompleted = completedCount === steps.length;

  // Check if dismissed from localStorage
  useEffect(() => {
    const dismissed = localStorage.getItem("onboarding-dismissed");
    if (dismissed === "true") {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem("onboarding-dismissed", "true");
    onDismiss?.();
  };

  if (isDismissed || allCompleted) {
    return null;
  }

  return (
    <div className="fixed right-4 bottom-4 z-50">
      {/* Collapsed state - just the button */}
      {!isOpen && (
        <Button
          className="group relative h-12 gap-2 rounded-full bg-primary px-4 shadow-lg transition-all duration-200 hover:shadow-xl"
          onClick={() => setIsOpen(true)}
        >
          <div className="relative">
            <Sparkles className="h-5 w-5" />
            {completedCount < steps.length && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 font-bold text-[10px] text-white">
                {steps.length - completedCount}
              </span>
            )}
          </div>
          <span className="font-medium">Get Started</span>
          <ChevronUp className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
        </Button>
      )}

      {/* Expanded state */}
      {isOpen && (
        <div className="slide-in-from-bottom-4 w-80 animate-in overflow-hidden rounded-xl border bg-card shadow-2xl duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Getting Started</p>
                <p className="text-muted-foreground text-xs">
                  {completedCount} of {steps.length} completed
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                className="h-7 w-7"
                onClick={() => setIsOpen(false)}
                size="icon"
                variant="ghost"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleDismiss}
                size="icon"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Progress */}
          <div className="px-4 pt-3">
            <Progress className="h-1.5" value={progress} />
          </div>

          {/* Steps */}
          <div className="p-2">
            {steps.map((step, index) => (
              <div
                className={cn(
                  "flex items-center gap-3 rounded-lg p-2 transition-colors",
                  !step.completed && "hover:bg-muted/50"
                )}
                key={step.id}
              >
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
                    step.completed
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "border-2 border-muted-foreground/30 text-muted-foreground"
                  )}
                >
                  {step.completed ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <span className="font-medium text-xs">{index + 1}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm",
                      step.completed
                        ? "text-muted-foreground line-through"
                        : "font-medium"
                    )}
                  >
                    {step.label}
                  </p>
                </div>
                {!step.completed && step.action && (
                  <Button
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    onClick={step.action}
                    size="sm"
                    variant="ghost"
                  >
                    {step.actionLabel || "Do it"}
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t bg-muted/30 px-4 py-2">
            <p className="text-center text-muted-foreground text-xs">
              Complete all steps to unlock full potential
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
