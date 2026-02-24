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
    name: "Institutional",
    description: "For regulated and high-trust teams.",
    price: "Annual license",
    popular: true,
    cta: "Request Private Briefing",
    features: [
      "Evidence-backed belief system",
      "Bi-temporal ledger",
      "Exposure modeling",
      "Governed intervention engine",
      "Structured onboarding",
    ],
  },
  {
    name: "Enterprise",
    description: "Dedicated deployment. Fiduciary-grade controls.",
    price: "Request commercial terms",
    cta: "Request Commercial Terms",
    features: [
      "Everything in Institutional",
      "Tenant isolation and policy controls",
      "SSO / SAML",
      "IP allowlisting",
      "Data residency",
      "Dedicated infrastructure",
      "Security review",
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
      className="relative overflow-hidden px-6 py-20 md:py-28"
      id="pricing"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[600px] w-[860px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-12 text-center"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            Pricing
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-5xl gap-4 md:gap-6 lg:grid-cols-2">
          {plans.map((plan, index) => (
            <motion.div
              className="group"
              initial={{ opacity: 0, y: 24 }}
              key={plan.name}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div
                className={`relative h-full overflow-hidden rounded-3xl p-6 md:p-8 ${
                  plan.popular
                    ? "bg-gradient-to-b from-amber-500/12 to-amber-500/[0.02]"
                    : "bg-gradient-to-b from-white/[0.04] to-transparent"
                }`}
              >
                <div
                  className={`pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ${
                    plan.popular ? "ring-amber-500/26" : "ring-white/[0.08]"
                  }`}
                />

                <div className="relative">
                  <h3 className="text-[30px] tracking-[-1px] md:text-[36px]">{plan.name}</h3>
                  <p className="mt-2 text-[14px] text-foreground/56 md:text-[15px]">
                    {plan.description}
                  </p>

                  <p className="mt-4 font-normal text-[34px] leading-none tracking-[-1.3px] md:text-[44px]">
                    {plan.price}
                  </p>

                  <ul className="mt-6 space-y-2.5">
                    {plan.features.map((feature) => (
                      <li
                        className="flex items-start gap-2.5 text-[14px] text-foreground/68 md:text-[15px]"
                        key={feature}
                      >
                        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/14 text-amber-300">
                          <Check className="h-3 w-3" />
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {isAuthenticated ? (
                    <a
                      className={`mt-7 flex h-11 w-full items-center justify-center rounded-full font-medium text-[14px] transition md:h-12 md:text-[15px] ${
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
                      className={`mt-7 flex h-11 w-full items-center justify-center rounded-full font-medium text-[14px] transition md:h-12 md:text-[15px] ${
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
