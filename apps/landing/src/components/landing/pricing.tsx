"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { useSession } from "@/lib/auth-client";
import { getAppUrl } from "@/lib/utils";

interface Plan {
  name: string;
  description: string;
  price: string;
  popular?: boolean;
  cta: string;
  features: string[];
}

const plans: Plan[] = [
  {
    name: "Pro",
    description: "Full memory infrastructure for growing teams",
    price: "$29",
    popular: true,
    cta: "Request Access",
    features: [
      "Unlimited source connections",
      "Full intelligence extraction",
      "Commitment and decision tracking",
      "Entity resolution across sources",
      "Natural language queries",
      "API access for agents",
      "Historical backfill",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    description: "Security, compliance, and custom deployments",
    price: "Custom",
    cta: "Book a Call",
    features: [
      "Everything in Pro",
      "Unlimited team members",
      "SSO/SAML integration",
      "Dedicated account manager",
      "Audit logs & security reviews",
      "Data residency options",
      "Custom integrations",
      "SLA & compliance",
    ],
  },
];

interface PricingProps {
  onRequestAccess?: () => void;
}

export function Pricing({ onRequestAccess }: PricingProps) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-32"
      id="pricing"
    >
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/8 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        {/* Section header */}
        <motion.div
          className="mb-12 text-center md:mb-20"
          initial={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-1.5 md:mb-6 md:gap-3 md:px-5 md:py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 md:h-2 md:w-2" />
            <span className="font-medium text-amber-400 text-xs tracking-wide md:text-sm">
              PRICING
            </span>
          </div>
          <h2 className="mb-4 font-normal text-[32px] leading-[1.1] tracking-[-1.5px] md:mb-6 md:text-[44px] md:tracking-[-2.2px] lg:text-[56px] lg:tracking-[-2.8px]">
            <span className="text-foreground">Infrastructure pricing</span>
            <br />
            <span className="text-foreground/40">that scales with you</span>
          </h2>
          <p className="mx-auto max-w-xl text-[15px] text-foreground/60 leading-relaxed md:text-[17px]">
            Per-seat pricing for teams of any size. Enterprise options for
            security, compliance, and custom deployments.
          </p>
        </motion.div>

        {/* Pricing cards */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <motion.div
              className="group"
              initial={{ opacity: 0, y: 30 }}
              key={plan.name}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div
                className={`relative h-full overflow-hidden rounded-2xl p-5 transition-all duration-300 md:rounded-3xl md:p-8 ${
                  plan.popular
                    ? "bg-gradient-to-b from-amber-500/10 to-amber-500/[0.02]"
                    : "bg-gradient-to-b from-white/[0.04] to-transparent hover:from-white/[0.06]"
                }`}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute top-4 right-4 md:top-6 md:right-6">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 md:gap-2 md:px-3 md:py-1">
                      <span className="h-1 w-1 rounded-full bg-amber-500 md:h-1.5 md:w-1.5" />
                      <span className="font-medium text-[10px] text-amber-400 md:text-xs">
                        Most Popular
                      </span>
                    </div>
                  </div>
                )}

                {/* Subtle border */}
                <div
                  className={`pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset md:rounded-3xl ${
                    plan.popular ? "ring-amber-500/20" : "ring-white/[0.05]"
                  }`}
                />

                {/* Content */}
                <div className="relative">
                  {/* Plan name & description */}
                  <div className="mb-5 md:mb-8">
                    <h3 className="mb-1.5 font-medium text-[18px] text-foreground md:mb-2 md:text-[22px]">
                      {plan.name}
                    </h3>
                    <p className="text-[13px] text-foreground/50 md:text-[14px]">
                      {plan.description}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="mb-5 md:mb-8">
                    <span className="font-normal text-[36px] text-foreground leading-none tracking-[-1.5px] md:text-[48px] md:tracking-[-2px]">
                      {plan.price}
                    </span>
                    {plan.price !== "Custom" && (
                      <span className="ml-1 text-[14px] text-foreground/40 md:text-[16px]">
                        /user/month
                      </span>
                    )}
                  </div>

                  {/* Features */}
                  <ul className="mb-6 space-y-2.5 md:mb-8 md:space-y-3">
                    {plan.features.map((feature) => (
                      <li
                        className="flex items-start gap-2.5 text-[13px] text-foreground/60 md:gap-3 md:text-[14px]"
                        key={feature}
                      >
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/10 md:h-5 md:w-5">
                          <Check className="h-2.5 w-2.5 text-amber-500 md:h-3 md:w-3" />
                        </div>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* CTA Button */}
                  {isAuthenticated ? (
                    <a
                      className={`flex h-11 w-full items-center justify-center rounded-full font-medium text-[14px] transition-all md:h-12 md:text-[15px] ${
                        plan.popular
                          ? "bg-white text-black hover:bg-white/90"
                          : "bg-white/10 text-white hover:bg-white/15"
                      }`}
                      href={getAppUrl("/dashboard")}
                    >
                      Open Dashboard
                    </a>
                  ) : (
                    <button
                      className={`flex h-11 w-full items-center justify-center rounded-full font-medium text-[14px] transition-all md:h-12 md:text-[15px] ${
                        plan.popular
                          ? "bg-white text-black hover:bg-white/90"
                          : "bg-white/10 text-white hover:bg-white/15"
                      }`}
                      onClick={onRequestAccess}
                      type="button"
                    >
                      {plan.cta}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
