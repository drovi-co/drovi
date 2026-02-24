"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { GitBranch, Radar, RefreshCcw, ScanLine, ShieldCheck } from "lucide-react";

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

const steps: Step[] = [
  {
    icon: ScanLine,
    title: "Ingest",
    description: "Ingests internal systems and external signals.",
  },
  {
    icon: RefreshCcw,
    title: "Normalize",
    description: "Normalizes them into structured observations.",
  },
  {
    icon: ShieldCheck,
    title: "Update Beliefs",
    description: "Updates institutional beliefs with explicit confidence.",
  },
  {
    icon: GitBranch,
    title: "Compute Impact",
    description: "Computes downstream impact across your exposure graph.",
  },
  {
    icon: Radar,
    title: "Propose Intervention",
    description: "Proposes governed interventions with rollback paths.",
  },
];

export function HowItWorks() {
  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-28"
      id="how-it-works"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 right-0 h-[620px] w-[620px] rounded-full bg-gradient-to-bl from-amber-500/8 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-12 text-center md:mb-14"
          initial={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.62 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            What Drovi Does
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.06] tracking-[-1.5px] md:text-[54px] md:tracking-[-2.4px]">
            A Single Ledger of Truth
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[15px] text-foreground/68 leading-relaxed md:text-[18px]">
            Across your organization and the world.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {steps.map((step, index) => (
            <motion.article
              className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5"
              initial={{ opacity: 0, y: 22 }}
              key={step.title}
              transition={{ duration: 0.5, delay: index * 0.07 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/14 text-amber-300">
                <step.icon className="h-5 w-5" />
              </div>
              <h3 className="text-[18px] leading-tight">{step.title}</h3>
              <p className="mt-2 text-[14px] text-foreground/64 leading-relaxed">
                {step.description}
              </p>
            </motion.article>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-[15px] text-foreground/78 leading-relaxed md:text-[17px]">
          Every belief has a state. Every state has evidence. Every change is
          time-bound.
        </p>
      </div>
    </section>
  );
}
