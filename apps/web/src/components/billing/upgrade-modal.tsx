/**
 * Upgrade Modal - Hard paywall for trial expiration
 *
 * This modal blocks app access when trial expires without subscription.
 * It cannot be dismissed - user must upgrade or logout.
 */

import {
  Building2,
  Calendar,
  CheckCircle2,
  Crown,
  LogOut,
  MessageSquare,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface UpgradeModalProps {
  trialDaysUsed?: number;
  onUpgrade?: () => void;
}

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  price: number | "custom";
  interval: "month" | "year";
  features: PlanFeature[];
  popular?: boolean;
  slug?: string;
  cta: string;
  ctaVariant: "default" | "secondary" | "outline";
}

const plans: Plan[] = [
  {
    id: "pro",
    name: "Pro",
    description: "Everything you need to master your inbox",
    price: 29,
    interval: "month",
    popular: true,
    slug: "pro",
    cta: "Upgrade to Pro",
    ctaVariant: "default",
    features: [
      { text: "All 8 AI Agents", included: true },
      { text: "Smart Inbox with priorities", included: true },
      { text: "Commitment & Decision tracking", included: true },
      { text: "Up to 10 team members", included: true },
      { text: "5 organizations", included: true },
      { text: "Email & chat support", included: true },
      { text: "API access", included: true },
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "Advanced features for growing teams",
    price: 49,
    interval: "month",
    slug: "business",
    cta: "Upgrade to Business",
    ctaVariant: "default",
    features: [
      { text: "Everything in Pro", included: true },
      { text: "Advanced analytics & reporting", included: true },
      { text: "Priority support", included: true },
      { text: "Up to 25 team members", included: true },
      { text: "10 organizations", included: true },
      { text: "Custom integrations", included: true },
      { text: "SSO (coming soon)", included: true },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Custom solutions for large organizations",
    price: "custom",
    interval: "month",
    cta: "Book a Call",
    ctaVariant: "outline",
    features: [
      { text: "Everything in Business", included: true },
      { text: "Unlimited team members", included: true },
      { text: "Unlimited organizations", included: true },
      { text: "Dedicated account manager", included: true },
      { text: "Custom AI training", included: true },
      { text: "On-premise deployment option", included: true },
      { text: "SLA & compliance", included: true },
    ],
  },
];

function PlanCard({
  plan,
  onSelect,
  isLoading,
}: {
  plan: Plan;
  onSelect: (plan: Plan) => void;
  isLoading: boolean;
}) {
  const Icon =
    plan.id === "pro" ? Zap : plan.id === "business" ? Crown : Building2;

  return (
    <Card
      className={cn(
        "relative flex flex-col",
        plan.popular && "border-primary shadow-lg ring-1 ring-primary"
      )}
    >
      {plan.popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
          Most Popular
        </Badge>
      )}

      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-lg",
              plan.popular
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-5" />
          </div>
          <div>
            <CardTitle className="text-lg">{plan.name}</CardTitle>
            <CardDescription className="text-xs">
              {plan.description}
            </CardDescription>
          </div>
        </div>

        <div className="mt-4">
          {plan.price === "custom" ? (
            <div className="flex items-baseline gap-1">
              <span className="font-bold text-3xl">Custom</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="font-bold text-3xl">${plan.price}</span>
              <span className="text-muted-foreground">/{plan.interval}</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <ul className="space-y-2.5">
          {plan.features.map((feature, index) => (
            <li className="flex items-start gap-2 text-sm" key={index}>
              <CheckCircle2
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  feature.included ? "text-primary" : "text-muted-foreground/40"
                )}
              />
              <span
                className={cn(!feature.included && "text-muted-foreground/60")}
              >
                {feature.text}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>

      <div className="p-6 pt-0">
        <Button
          className="w-full"
          disabled={isLoading}
          onClick={() => onSelect(plan)}
          variant={plan.ctaVariant}
        >
          {plan.id === "enterprise" && (
            <MessageSquare className="mr-2 size-4" />
          )}
          {plan.cta}
        </Button>
      </div>
    </Card>
  );
}

export function UpgradeModal({ trialDaysUsed = 7 }: UpgradeModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectPlan = async (plan: Plan) => {
    if (plan.id === "enterprise") {
      // Open Calendly or contact form for enterprise
      window.open("https://calendly.com/drovi/enterprise", "_blank");
      return;
    }

    setIsLoading(true);
    try {
      // Use Polar checkout for paid plans
      if ("checkout" in authClient) {
        await (
          authClient as unknown as {
            checkout: (opts: { slug: string | undefined }) => Promise<void>;
          }
        ).checkout({
          slug: plan.slug,
        });
      } else {
        toast.error("Billing is not configured. Please contact support.");
      }
    } catch {
      toast.error("Failed to start checkout", {
        description: "Please try again",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-amber-500">
            <Calendar className="size-4" />
            <span className="font-medium text-sm">
              Your {trialDaysUsed}-day trial has ended
            </span>
          </div>

          <h1 className="mb-2 font-bold text-3xl tracking-tight">
            Upgrade to Continue Using Drovi
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            Your free trial has expired. Choose a plan to continue accessing
            your AI-powered email intelligence, commitments, decisions, and
            more.
          </p>
        </div>

        {/* Features highlight */}
        <div className="mb-8 flex flex-wrap items-center justify-center gap-4 text-muted-foreground text-sm">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary" />
            <span>8 AI Agents</span>
          </div>
          <Separator className="h-4" orientation="vertical" />
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-primary" />
            <span>Commitment Tracking</span>
          </div>
          <Separator className="h-4" orientation="vertical" />
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-primary" />
            <span>Decision Log</span>
          </div>
          <Separator className="h-4" orientation="vertical" />
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-primary" />
            <span>Smart Inbox</span>
          </div>
        </div>

        {/* Plan cards */}
        <div className="mb-8 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              isLoading={isLoading}
              key={plan.id}
              onSelect={handleSelectPlan}
              plan={plan}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-muted-foreground text-sm">
            All plans include a 14-day money-back guarantee. Cancel anytime.
          </p>

          <Button
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            size="sm"
            variant="ghost"
          >
            <LogOut className="mr-2 size-4" />
            Sign out and return later
          </Button>
        </div>
      </div>
    </div>
  );
}

export default UpgradeModal;
