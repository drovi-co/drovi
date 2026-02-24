"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

const problems = [
  "External events reach your organization too late",
  "Commitments drift without detection",
  "Assumptions decay silently",
  "Teams operate on outdated beliefs",
  "Agents act without institutional context",
];

export function ProblemSolution() {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[840px] w-[840px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-red-500/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.62 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            The Problem
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.06] tracking-[-1.5px] md:text-[54px] md:tracking-[-2.4px]">
            Institutions do not fail from lack of data.
            <br />
            <span className="text-foreground/48">They fail from invisible exposure.</span>
          </h2>
        </motion.div>

        <motion.div
          className="mt-12 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 md:p-8"
          initial={{ opacity: 0, y: 22 }}
          transition={{ duration: 0.55, delay: 0.06 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-red-500/10 px-4 py-1.5 text-red-300 text-xs uppercase tracking-[0.18em]">
            <AlertTriangle className="h-3.5 w-3.5" />
            Without Drovi
          </p>

          <ul className="space-y-3">
            {problems.map((problem) => (
              <li
                className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-[15px] text-foreground/84 leading-relaxed md:text-[17px]"
                key={problem}
              >
                {problem}
              </li>
            ))}
          </ul>

          <p className="mt-6 text-[16px] text-foreground/82 leading-relaxed md:text-[18px]">
            The result is not noise. It is preventable damage.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
