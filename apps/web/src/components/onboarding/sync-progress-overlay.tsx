import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  CheckCircle2,
  FileSearch,
  Lightbulb,
  Mail,
  MessageSquare,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/utils/trpc";

interface SyncProgressOverlayProps {
  organizationId: string;
  onComplete: () => void;
  /** Minimum time to show overlay (ms) - ensures user sees progress */
  minDisplayTime?: number;
}

const INTELLIGENCE_STEPS = [
  {
    icon: Mail,
    label: "Connecting to your inbox",
    description: "Establishing secure connection",
  },
  {
    icon: FileSearch,
    label: "Scanning emails",
    description: "Finding conversations to analyze",
  },
  {
    icon: Brain,
    label: "Understanding context",
    description: "Reading and comprehending your emails",
  },
  {
    icon: Target,
    label: "Extracting commitments",
    description: "Finding promises and deadlines",
  },
  {
    icon: Lightbulb,
    label: "Identifying decisions",
    description: "Tracking important choices made",
  },
  {
    icon: MessageSquare,
    label: "Detecting open loops",
    description: "Finding unanswered questions",
  },
  {
    icon: Sparkles,
    label: "Building intelligence",
    description: "Creating your knowledge graph",
  },
];

export function SyncProgressOverlay({
  organizationId,
  onComplete,
  minDisplayTime = 5000,
}: SyncProgressOverlayProps) {
  const [startTime] = useState(() => Date.now());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasMinTimeElapsed, setHasMinTimeElapsed] = useState(false);

  // Poll for sync status
  const { data: syncStatus } = useQuery({
    ...trpc.emailAccounts.getSyncStatus.queryOptions({
      organizationId,
    }),
    refetchInterval: 2000, // Poll every 2 seconds
    enabled: !!organizationId,
  });

  // Get the first account's status (primary during onboarding)
  const accountStatus = syncStatus?.[0];
  const isComplete = accountStatus?.isComplete ?? false;
  const overallProgress = accountStatus?.overallProgress ?? 0;
  const threadCount = accountStatus?.threadCount ?? 0;
  const messageCount = accountStatus?.messageCount ?? 0;
  const phase = accountStatus?.phase ?? "idle";
  const phaseLabel = accountStatus?.phaseLabel ?? "Initializing...";

  // Ensure minimum display time
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasMinTimeElapsed(true);
    }, minDisplayTime);
    return () => clearTimeout(timer);
  }, [minDisplayTime]);

  // Animate through steps based on progress
  useEffect(() => {
    const stepCount = INTELLIGENCE_STEPS.length;
    let targetStep: number;

    if (phase === "idle" && threadCount === 0) {
      targetStep = 0;
    } else if (phase === "priority" && overallProgress < 10) {
      targetStep = 1;
    } else if (phase === "priority" && overallProgress < 20) {
      targetStep = 2;
    } else if (phase === "priority" && overallProgress < 50) {
      targetStep = 3;
    } else if (phase === "priority" || phase === "extended") {
      targetStep = 4;
    } else if (phase === "archive") {
      targetStep = 5;
    } else {
      targetStep = stepCount - 1;
    }

    // Also cycle through steps for visual interest
    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < targetStep) return prev + 1;
        return prev;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [phase, overallProgress, threadCount]);

  // Complete when sync is done AND minimum time has elapsed
  useEffect(() => {
    if (isComplete && hasMinTimeElapsed) {
      // Small delay to show completion state
      const timer = setTimeout(() => {
        onComplete();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isComplete, hasMinTimeElapsed, onComplete]);

  const currentStep = INTELLIGENCE_STEPS[currentStepIndex];
  const CurrentIcon = currentStep?.icon ?? Zap;

  // Calculate effective progress (use thread count if available, otherwise phase progress)
  const effectiveProgress = Math.min(
    isComplete ? 100 : Math.max(overallProgress, threadCount > 0 ? 15 : 5),
    100
  );

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
    >
      <div className="mx-auto max-w-md px-6 text-center">
        {/* Animated icon */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0],
          }}
          className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10"
          transition={{
            duration: 2,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              initial={{ opacity: 0, scale: 0.8 }}
              key={currentStepIndex}
              transition={{ duration: 0.3 }}
            >
              {isComplete ? (
                <CheckCircle2 className="h-12 w-12 text-green-600" />
              ) : (
                <CurrentIcon className="h-12 w-12 text-primary" />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* Title */}
        <AnimatePresence mode="wait">
          <motion.h2
            animate={{ opacity: 1, y: 0 }}
            className="mb-2 font-semibold text-2xl"
            exit={{ opacity: 0, y: -10 }}
            initial={{ opacity: 0, y: 10 }}
            key={isComplete ? "complete" : currentStepIndex}
            transition={{ duration: 0.3 }}
          >
            {isComplete ? "You're all set!" : currentStep?.label}
          </motion.h2>
        </AnimatePresence>

        {/* Description */}
        <AnimatePresence mode="wait">
          <motion.p
            animate={{ opacity: 1 }}
            className="mb-8 text-muted-foreground"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={isComplete ? "complete-desc" : currentStepIndex}
            transition={{ duration: 0.3 }}
          >
            {isComplete
              ? "Your inbox intelligence is ready"
              : currentStep?.description}
          </motion.p>
        </AnimatePresence>

        {/* Progress bar */}
        <div className="mb-4">
          <Progress className="h-2" value={effectiveProgress} />
        </div>

        {/* Stats */}
        <div className="mb-8 flex justify-center gap-8 text-sm">
          {threadCount > 0 && (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              initial={{ opacity: 0, scale: 0.9 }}
            >
              <span className="font-semibold text-foreground">
                {threadCount.toLocaleString()}
              </span>
              <span className="ml-1 text-muted-foreground">
                {threadCount === 1 ? "thread" : "threads"}
              </span>
            </motion.div>
          )}
          {messageCount > 0 && (
            <motion.div
              animate={{ opacity: 1, scale: 1 }}
              initial={{ opacity: 0, scale: 0.9 }}
            >
              <span className="font-semibold text-foreground">
                {messageCount.toLocaleString()}
              </span>
              <span className="ml-1 text-muted-foreground">
                {messageCount === 1 ? "message" : "messages"}
              </span>
            </motion.div>
          )}
        </div>

        {/* Phase indicator */}
        {!isComplete && (
          <p className="text-muted-foreground text-xs">
            {phaseLabel}
            {effectiveProgress > 0 && ` (${Math.round(effectiveProgress)}%)`}
          </p>
        )}

        {/* Subtle loading dots */}
        {!isComplete && (
          <div className="mt-6 flex justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                animate={{ opacity: [0.3, 1, 0.3] }}
                className="h-1.5 w-1.5 rounded-full bg-primary/50"
                key={i}
                transition={{
                  duration: 1.5,
                  repeat: Number.POSITIVE_INFINITY,
                  delay: i * 0.2,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
