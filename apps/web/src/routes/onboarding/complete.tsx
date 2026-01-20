import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Rocket,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding/complete")({
  component: CompletePage,
});

// Confetti component
function Confetti() {
  const [particles, setParticles] = useState<
    Array<{
      id: number;
      x: number;
      color: string;
      delay: number;
      duration: number;
    }>
  >([]);

  useEffect(() => {
    const colors = [
      "#6366f1",
      "#8b5cf6",
      "#d946ef",
      "#f43f5e",
      "#f97316",
      "#eab308",
      "#22c55e",
      "#06b6d4",
    ];
    const newParticles = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.5,
      duration: 2 + Math.random() * 2,
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {particles.map((particle) => (
        <div
          className="absolute h-2 w-2 animate-confetti rounded-full"
          key={particle.id}
          style={{
            left: `${particle.x}%`,
            backgroundColor: particle.color,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti linear forwards;
        }
      `}</style>
    </div>
  );
}

const features = [
  {
    icon: Rocket,
    title: "Quick Start Guide",
    description: "Learn the basics and get productive in minutes",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Invite team members and work together seamlessly",
  },
  {
    icon: Zap,
    title: "AI-Powered Insights",
    description: "Let AI help you discover valuable leads faster",
  },
];

function CompletePage() {
  const navigate = useNavigate();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const [progress, setProgress] = useState(0);
  const [showConfetti, setShowConfetti] = useState(true);

  // Animate progress bar
  useEffect(() => {
    const timer = setTimeout(() => setProgress(100), 100);
    return () => clearTimeout(timer);
  }, []);

  // Hide confetti after animation
  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  const handleGoToDashboard = useCallback(() => {
    navigate({ to: "/dashboard" });
  }, [navigate]);

  // Auto-redirect after 8 seconds
  useEffect(() => {
    const timer = setTimeout(handleGoToDashboard, 8000);
    return () => clearTimeout(timer);
  }, [handleGoToDashboard]);

  return (
    <>
      {showConfetti && <Confetti />}
      <OnboardingLayout step={4}>
        <Card className="border-0 shadow-none lg:border lg:shadow-sm">
          <CardHeader className="pb-2 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-9 w-9 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">You're All Set!</CardTitle>
            <CardDescription className="text-base">
              Welcome to{" "}
              <span className="font-medium text-foreground">
                {activeOrg?.name || "Drovi"}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {/* Welcome message */}
            <div className="rounded-xl border border-primary/10 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 p-5 text-center">
              <Sparkles className="mx-auto mb-2 h-6 w-6 text-primary" />
              <p className="text-sm">
                Welcome aboard,{" "}
                <span className="font-semibold">
                  {session?.user?.name || "there"}
                </span>
                !
                <br />
                <span className="text-muted-foreground">
                  Your workspace is ready to use.
                </span>
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3">
              <h4 className="text-center font-medium text-sm">
                What you can do next
              </h4>
              <div className="grid gap-3">
                {features.map((feature) => (
                  <div
                    className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                    key={feature.title}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <feature.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{feature.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button className="h-11 w-full" onClick={handleGoToDashboard}>
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>Redirecting automatically...</span>
                  <span>8s</span>
                </div>
                <Progress className="h-1" value={progress} />
              </div>
            </div>
          </CardContent>
        </Card>
      </OnboardingLayout>
    </>
  );
}
