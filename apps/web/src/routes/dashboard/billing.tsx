import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  Loader2,
  Receipt,
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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/billing")({
  component: BillingPage,
});

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
  currentPlan,
  onSelect,
  isLoading,
}: {
  plan: Plan;
  currentPlan: string;
  onSelect: (plan: Plan) => void;
  isLoading: boolean;
}) {
  const isCurrent = currentPlan === plan.id;

  const Icon =
    plan.id === "pro" ? Zap : plan.id === "business" ? Crown : Building2;

  return (
    <Card
      className={`relative ${
        plan.popular
          ? "scale-105 border-primary shadow-lg"
          : isCurrent
            ? "border-primary/50"
            : ""
      }`}
    >
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="gap-1 bg-primary">
            <Sparkles className="h-3 w-3" />
            Most Popular
          </Badge>
        </div>
      )}
      <CardHeader className="pt-8">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <CardTitle>{plan.name}</CardTitle>
          {isCurrent && <Badge variant="secondary">Current</Badge>}
        </div>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-1">
          {plan.price === "custom" ? (
            <span className="font-bold text-3xl">Custom</span>
          ) : (
            <>
              <span className="font-bold text-4xl">${plan.price}</span>
              <span className="text-muted-foreground">/{plan.interval}</span>
            </>
          )}
        </div>

        <ul className="space-y-2">
          {plan.features.map((feature) => (
            <li className="flex items-center gap-2 text-sm" key={feature.text}>
              {feature.included ? (
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )}
              <span
                className={
                  feature.included ? "" : "text-muted-foreground line-through"
                }
              >
                {feature.text}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        {isCurrent ? (
          <Button className="w-full" disabled variant="outline">
            Current Plan
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={isLoading}
            onClick={() => onSelect(plan)}
            variant={plan.ctaVariant}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              plan.cta
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

interface CustomerState {
  activeSubscriptions?: Array<{
    product?: { name?: string };
    status?: string;
  }>;
}

function BillingPage() {
  const { customerState } = Route.useRouteContext() as {
    customerState: CustomerState | null;
  };
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Fetch trial/credit status
  const { data: creditStatus } = useQuery({
    ...trpc.credits.getStatus.queryOptions(),
  });

  const hasProSubscription =
    (customerState?.activeSubscriptions?.length ?? 0) > 0;
  const subscription = customerState?.activeSubscriptions?.[0];

  // Determine current plan based on subscription
  const currentPlan = hasProSubscription
    ? subscription?.product?.name?.toLowerCase() === "enterprise"
      ? "enterprise"
      : subscription?.product?.name?.toLowerCase() === "business"
        ? "business"
        : "pro"
    : "trial";

  const handleSelectPlan = async (plan: Plan) => {
    // Handle Enterprise - open Calendly
    if (plan.id === "enterprise") {
      window.open("https://calendly.com/drovi/enterprise", "_blank");
      return;
    }

    if (!plan.slug) {
      toast.error("This plan is not available for purchase");
      return;
    }

    setIsLoading(true);
    setSelectedPlan(plan.id);

    try {
      if ("checkout" in authClient) {
        await (
          authClient as unknown as {
            checkout: (opts: { slug: string }) => Promise<void>;
          }
        ).checkout({
          slug: plan.slug,
        });
      } else {
        toast.error("Billing is not configured. Please contact support.");
      }
    } catch {
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setIsLoading(false);
      setSelectedPlan(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      if ("customer" in authClient && authClient.customer) {
        await (
          authClient.customer as unknown as {
            portal: () => Promise<void>;
          }
        ).portal();
      } else {
        toast.error("Billing is not configured. Please contact support.");
      }
    } catch {
      toast.error("Failed to open billing portal. Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription and billing settings
        </p>
      </div>

      {/* Trial Status Card - shown when on trial */}
      {!hasProSubscription && creditStatus && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  {creditStatus.isTrialActive ? "Free Trial" : "Trial Status"}
                </CardTitle>
                <CardDescription>
                  {creditStatus.isTrialActive
                    ? "Explore all features during your free trial"
                    : "Your trial has ended. Upgrade to continue using Drovi."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {creditStatus.isTrialActive ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span>Trial Progress</span>
                  <span className="text-muted-foreground">
                    {creditStatus.trialDaysRemaining} days remaining
                  </span>
                </div>
                <Progress value={100 - creditStatus.trialProgress} />
                <p className="text-muted-foreground text-sm">
                  Your 7-day free trial gives you full access to all features.
                  Upgrade anytime to continue after your trial ends.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Badge
                  className="border-amber-600 text-amber-600"
                  variant="outline"
                >
                  Trial Expired
                </Badge>
                <span className="text-muted-foreground text-sm">
                  Choose a plan below to continue
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Current Subscription Card - shown when subscribed */}
      {hasProSubscription && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Current Subscription
                </CardTitle>
                <CardDescription>
                  Your current plan and billing information
                </CardDescription>
              </div>
              <Button onClick={handleManageSubscription} variant="outline">
                <ExternalLink className="mr-2 h-4 w-4" />
                Manage Subscription
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Plan</p>
                <div className="flex items-center gap-2">
                  <Badge variant="default">
                    {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
                  </Badge>
                  <Badge className="text-green-600" variant="outline">
                    Active
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Billing Period</p>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Monthly</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Status</p>
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm capitalize">
                    {subscription?.status ?? "Active"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plans Section */}
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="font-bold text-2xl">
            {hasProSubscription ? "Upgrade Your Plan" : "Choose Your Plan"}
          </h2>
          <p className="text-muted-foreground">
            {hasProSubscription
              ? "Switch to a different plan to unlock more features"
              : "Select the plan that best fits your needs"}
          </p>
        </div>

        <div className="grid gap-6 pt-4 md:grid-cols-3 lg:gap-8">
          {plans.map((plan) => (
            <PlanCard
              currentPlan={currentPlan}
              isLoading={isLoading && selectedPlan === plan.id}
              key={plan.id}
              onSelect={handleSelectPlan}
              plan={plan}
            />
          ))}
        </div>
      </div>

      <Separator />

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle>Frequently Asked Questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium">Can I cancel anytime?</h4>
            <p className="text-muted-foreground text-sm">
              Yes, you can cancel your subscription at any time. You'll continue
              to have access until the end of your billing period.
            </p>
          </div>
          <div>
            <h4 className="font-medium">What happens after my trial ends?</h4>
            <p className="text-muted-foreground text-sm">
              After your 7-day free trial ends, you'll need to choose a paid
              plan to continue using Drovi. All your data will be preserved.
            </p>
          </div>
          <div>
            <h4 className="font-medium">What payment methods do you accept?</h4>
            <p className="text-muted-foreground text-sm">
              We accept all major credit cards (Visa, Mastercard, American
              Express) through our secure payment provider Polar.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Can I upgrade or downgrade my plan?</h4>
            <p className="text-muted-foreground text-sm">
              Yes, you can change your plan at any time. When upgrading, you'll
              be charged the prorated difference. When downgrading, the change
              takes effect at the end of your current billing period.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
