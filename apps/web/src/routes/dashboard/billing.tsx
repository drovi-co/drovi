import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Mail,
  Receipt,
  Sparkles,
  Users,
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
import { useSubscription } from "@/hooks/use-subscription";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/billing")({
  component: BillingPage,
});

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  id: "pro" | "enterprise";
  name: string;
  description: string;
  price: number | "custom";
  priceLabel: string;
  interval: "month";
  features: PlanFeature[];
  popular?: boolean;
  cta: string;
  ctaVariant: "default" | "outline";
}

const plans: Plan[] = [
  {
    id: "pro",
    name: "Pro",
    description: "Everything you need to master your inbox",
    price: 29,
    priceLabel: "per user / month",
    interval: "month",
    popular: true,
    cta: "Upgrade to Pro",
    ctaVariant: "default",
    features: [
      { text: "Unlimited email connections", included: true },
      { text: "AI intelligence extraction", included: true },
      { text: "Commitment & decision tracking", included: true },
      { text: "Contact intelligence", included: true },
      { text: "Unlimited team members", included: true },
      { text: "Priority support", included: true },
      { text: "5,000 AI credits/month", included: true },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Custom solutions for large organizations",
    price: "custom",
    priceLabel: "Custom pricing",
    interval: "month",
    cta: "Contact Sales",
    ctaVariant: "outline",
    features: [
      { text: "Everything in Pro", included: true },
      { text: "SSO/SAML integration", included: true },
      { text: "SCIM provisioning", included: true },
      { text: "Advanced analytics", included: true },
      { text: "Custom integrations", included: true },
      { text: "Dedicated support & SLA", included: true },
      { text: "50,000 AI credits/month", included: true },
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
  currentPlan: "pro" | "enterprise" | "trial" | null;
  onSelect: (plan: Plan) => void;
  isLoading: boolean;
}) {
  const isCurrent = currentPlan === plan.id;
  const Icon = plan.id === "pro" ? Zap : Building2;

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
        <div className="space-y-1">
          {plan.price === "custom" ? (
            <span className="font-bold text-3xl">Custom</span>
          ) : (
            <span className="font-bold text-4xl">${plan.price}</span>
          )}
          <p className="text-muted-foreground text-sm">{plan.priceLabel}</p>
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

function BillingPage() {
  const trpc = useTRPC();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Use the subscription hook for plan status
  const {
    subscription,
    isLoading: subscriptionLoading,
    isPro,
    isEnterprise,
    isActive,
    isTrialing,
    isPastDue,
    trialDaysLeft,
    monthlyTotal,
    pricePerSeat,
    seatCount,
  } = useSubscription();

  // Fetch trial/credit status for trial progress
  const { data: creditStatus } = useQuery(
    trpc.credits.getStatus.queryOptions()
  );

  // Upgrade to Pro mutation
  const upgradeMutation = useMutation(
    trpc.credits.upgradeToPro.mutationOptions({
      onSuccess: (data) => {
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to start checkout");
      },
    })
  );

  // Request Enterprise mutation
  const enterpriseMutation = useMutation(
    trpc.credits.requestEnterprise.mutationOptions({
      onSuccess: (data) => {
        toast.success(data.message);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to submit request");
      },
    })
  );

  // Determine current plan state
  const currentPlan: "pro" | "enterprise" | "trial" | null = isEnterprise
    ? "enterprise"
    : isPro && isActive
      ? "pro"
      : isTrialing
        ? "trial"
        : null;

  const hasActiveSubscription = isActive && (isPro || isEnterprise);

  const handleSelectPlan = async (plan: Plan) => {
    // Handle Enterprise - open contact form or send request
    if (plan.id === "enterprise") {
      setIsLoading(true);
      setSelectedPlan(plan.id);
      try {
        await enterpriseMutation.mutateAsync({});
      } finally {
        setIsLoading(false);
        setSelectedPlan(null);
      }
      return;
    }

    // Handle Pro upgrade
    setIsLoading(true);
    setSelectedPlan(plan.id);
    try {
      await upgradeMutation.mutateAsync();
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
        toast.error("Billing portal is not available. Please contact support.");
      }
    } catch {
      toast.error("Failed to open billing portal. Please try again.");
    }
  };

  if (subscriptionLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription and billing settings
        </p>
      </div>

      {/* Trial Status Card - shown when on trial */}
      {isTrialing && creditStatus && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Free Trial
                </CardTitle>
                <CardDescription>
                  Explore all features during your free trial
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span>Trial Progress</span>
                <span className="text-muted-foreground">
                  {trialDaysLeft} days remaining
                </span>
              </div>
              <Progress value={((7 - trialDaysLeft) / 7) * 100} />
              <p className="text-muted-foreground text-sm">
                Your 7-day free trial gives you full access to all Pro features.
                Upgrade anytime to continue after your trial ends.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trial Expired Card */}
      {!(isActive || isTrialing) && subscription && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-amber-600">
                {subscription.status === "expired"
                  ? "Trial Expired"
                  : "Subscription Inactive"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {subscription.status === "expired"
                ? "Your trial has ended. Choose a plan below to continue using Drovi and keep all your data."
                : "Your subscription is no longer active. Please upgrade to continue using Drovi."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Past Due Warning */}
      {isPastDue && (
        <Card className="border-red-500/50 bg-red-500/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <CardTitle className="text-red-600">Payment Past Due</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Your last payment failed. Please update your payment method to
              avoid service interruption.
            </p>
            <Button
              className="mt-4"
              onClick={handleManageSubscription}
              variant="destructive"
            >
              Update Payment Method
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current Subscription Card - shown when subscribed */}
      {hasActiveSubscription && subscription && (
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
            <div className="grid gap-6 md:grid-cols-4">
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Plan</p>
                <div className="flex items-center gap-2">
                  <Badge variant="default">
                    {subscription.planType === "enterprise"
                      ? "Enterprise"
                      : "Pro"}
                  </Badge>
                  <Badge className="text-green-600" variant="outline">
                    Active
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Team Size</p>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    {seatCount} {seatCount === 1 ? "seat" : "seats"}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Price per Seat</p>
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">${pricePerSeat}/month</span>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">Monthly Total</p>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-sm">
                    ${monthlyTotal.toFixed(2)}/month
                  </span>
                </div>
              </div>
            </div>

            {subscription.currentPeriodEnd && (
              <div className="mt-4 flex items-center gap-2 border-t pt-4 text-muted-foreground text-sm">
                <Calendar className="h-4 w-4" />
                <span>
                  Next billing date:{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                    "en-US",
                    {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plans Section */}
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="font-bold text-2xl">
            {hasActiveSubscription ? "Change Your Plan" : "Choose Your Plan"}
          </h2>
          <p className="text-muted-foreground">
            {hasActiveSubscription
              ? "Switch to Enterprise for advanced features"
              : "Select the plan that best fits your needs"}
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl gap-6 pt-4 md:grid-cols-2 lg:gap-8">
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
            <h4 className="font-medium">How does per-user pricing work?</h4>
            <p className="text-muted-foreground text-sm">
              You're charged $29/month for each team member with access to
              Drovi. When you add or remove team members, your bill adjusts
              automatically.
            </p>
          </div>
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
            <h4 className="font-medium">
              What's included in the Enterprise plan?
            </h4>
            <p className="text-muted-foreground text-sm">
              Enterprise includes SSO/SAML, SCIM provisioning, advanced
              analytics, custom integrations, dedicated support, and SLA
              guarantees. Contact us for custom pricing.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Contact Support */}
      <Card>
        <CardContent className="flex flex-col items-center justify-between gap-4 py-6 sm:flex-row">
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Need help with billing?</p>
              <p className="text-muted-foreground text-sm">
                Our team is here to help with any questions
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <a href="mailto:support@drovi.co">Contact Support</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
