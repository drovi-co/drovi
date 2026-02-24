"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Brain,
  ChartNetwork,
  HandCoins,
  Scale,
  ShieldCheck,
  Split,
} from "lucide-react";
import { useRef } from "react";

interface Capability {
  icon: LucideIcon;
  title: string;
  description: string;
}

const capabilities: Capability[] = [
  {
    icon: Brain,
    title: "Belief Graph",
    description:
      "Transitions every critical claim through asserted, corroborated, contested, degraded, or retracted states.",
  },
  {
    icon: ChartNetwork,
    title: "Causal Pressure",
    description:
      "Computes directional impact from external events to internal exposures, dependencies, and obligations.",
  },
  {
    icon: Split,
    title: "Counterfactual Lab",
    description:
      "Compares interventions across expected utility, downside risk, and assumption sensitivity before action.",
  },
  {
    icon: Scale,
    title: "Obligation Sentinel",
    description:
      "Detects legal, policy, and contract conflicts pre-breach with recommended mitigation pathways.",
  },
  {
    icon: ShieldCheck,
    title: "Temporal Ledger",
    description:
      "Answers what was believed when, and what evidence justified each high-stakes transition.",
  },
  {
    icon: HandCoins,
    title: "ROI Through Prevention",
    description:
      "Designed to reduce unseen risk events and prevent liability or opportunity decay across operations.",
  },
];

const entranceEase = [0.22, 1, 0.36, 1] as const;

export function WorldBrainCapabilities() {
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 90%", "end 10%"],
  });
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 110,
    damping: 24,
    mass: 0.32,
  });
  const haloScale = useTransform(smoothProgress, [0, 1], [0.86, 1.1]);
  const haloY = useTransform(smoothProgress, [0, 1], [70, -60]);
  const gridY = useTransform(smoothProgress, [0, 1], [18, -16]);

  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28" ref={sectionRef}>
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute top-1/2 left-1/2 h-[940px] w-[940px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber-500/8 via-transparent to-transparent blur-3xl"
          style={
            reduceMotion
              ? undefined
              : {
                  scale: haloScale,
                  y: haloY,
                }
          }
        />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-12 text-center"
          initial={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.7, ease: entranceEase }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/80 text-xs uppercase tracking-[0.2em] md:text-sm">
            Why it matters now
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.08] tracking-[-1.6px] md:text-[52px] md:tracking-[-2.3px]">
            World Brain turns memory into institutional intelligence.
          </h2>
        </motion.div>

        <motion.div
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          style={reduceMotion ? undefined : { y: gridY }}
        >
          {capabilities.map((capability, index) => (
            <motion.article
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent p-5 md:p-6"
              initial={{ opacity: 0, y: 20 }}
              key={capability.title}
              transition={{ duration: 0.55, delay: index * 0.08, ease: entranceEase }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={{ y: -6, transition: { type: "spring", stiffness: 260, damping: 24 } }}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(245,158,11,0.2),transparent_52%)] opacity-0 transition group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/14 text-amber-400">
                  <capability.icon className="h-5 w-5" />
                </div>
                <h3 className="font-medium text-[21px] leading-tight tracking-[-0.3px] md:text-[24px]">
                  {capability.title}
                </h3>
                <p className="mt-3 text-foreground/64 text-sm leading-relaxed md:text-[15px]">
                  {capability.description}
                </p>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
