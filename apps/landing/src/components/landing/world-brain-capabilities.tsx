"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ChartNetwork, History, Landmark, Scale, Split } from "lucide-react";

interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
  bullets?: string[];
}

const capabilities: Capability[] = [
  {
    icon: History,
    title: "1. Belief Graph",
    description:
      "Every critical claim transitions through explicit epistemic states.",
    bullets: ["asserted", "corroborated", "contested", "degraded", "retracted"],
  },
  {
    icon: ChartNetwork,
    title: "2. Causal Pressure",
    description:
      "External shift → Exposure path → Internal consequence → Severity ranking.",
  },
  {
    icon: Split,
    title: "3. Counterfactual Lab",
    description:
      "Before acting, compare Intervention A, Intervention B, and Do Nothing across expected utility, downside risk, and assumption sensitivity.",
  },
  {
    icon: Scale,
    title: "4. Obligation Sentinel",
    description:
      "Contracts, regulation, and policy conflict detection before breach, with mapped mitigation pathways and evidence.",
  },
  {
    icon: Landmark,
    title: "5. Temporal Ledger",
    description:
      "Ask what was believed on a date, what changed, and what justified each transition. You receive a provable trail.",
  },
];

export function WorldBrainCapabilities() {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[900px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-12 text-center"
          initial={{ opacity: 0, y: 22 }}
          transition={{ duration: 0.62 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            Core Capabilities
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.06] tracking-[-1.5px] md:text-[52px] md:tracking-[-2.4px]">
            Action is governed.
            <br />
            <span className="text-foreground/48">Not improvised.</span>
          </h2>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilities.map((capability, index) => (
            <motion.article
              className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-6"
              initial={{ opacity: 0, y: 20 }}
              key={capability.title}
              transition={{ duration: 0.5, delay: index * 0.07 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/14 text-amber-300">
                <capability.icon className="h-5 w-5" />
              </div>
              <h3 className="text-[21px] leading-tight tracking-[-0.4px] md:text-[24px]">
                {capability.title}
              </h3>
              <p className="mt-3 text-[14px] text-foreground/66 leading-relaxed md:text-[15px]">
                {capability.description}
              </p>
              {capability.bullets ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {capability.bullets.map((state) => (
                    <span
                      className="rounded-full border border-white/14 bg-black/30 px-3 py-1.5 text-[12px] text-foreground/75 uppercase tracking-wide"
                      key={state}
                    >
                      {state}
                    </span>
                  ))}
                </div>
              ) : null}
            </motion.article>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-[15px] text-foreground/72 leading-relaxed md:text-[17px]">
          No silent narrative drift. Confidence is explicit and recalibrated.
        </p>
      </div>
    </section>
  );
}
