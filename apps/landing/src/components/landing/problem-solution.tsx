"use client";

import { motion } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";

const problems = [
  "Decisions live in scattered threads, never connected",
  "Commitments get made — then forgotten",
  "Work spans internal teams and customers with no single view",
  "The same discussions repeat because no one remembers",
  "Work happens. Memory doesn't.",
];

const solutions = [
  "Connects to email, chat, docs, meetings, and CRM",
  "Extracts what matters: decisions, commitments, risks, ownership",
  "Spans internal and external conversations automatically",
  "One place to see what was decided, promised, and assigned",
  "Keeps everything consistent, traceable, and up to date",
];

export function ProblemSolution() {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-32">
      {/* Subtle background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber-500/5 via-transparent to-transparent blur-3xl" />
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
          <h2 className="mb-6 font-normal text-[32px] leading-[1.1] tracking-[-1.5px] md:text-[44px] md:tracking-[-2.2px] lg:text-[56px] lg:tracking-[-2.8px]">
            <span className="text-foreground/40">
              Companies don't lack tools.
            </span>
            <br />
            <span className="text-foreground">They lack memory.</span>
          </h2>
        </motion.div>

        {/* Two columns */}
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
          {/* The Problem */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, x: 0 }}
          >
            <div className="mb-8 inline-flex items-center gap-3 rounded-full bg-red-500/10 px-5 py-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="font-medium text-red-400 text-sm tracking-wide">
                WITHOUT DROVI
              </span>
            </div>
            <div className="space-y-5">
              {problems.map((problem, index) => (
                <motion.div
                  className="group flex items-start gap-4"
                  initial={{ opacity: 0, x: -20 }}
                  key={problem}
                  transition={{ duration: 0.4, delay: 0.3 + index * 0.1 }}
                  viewport={{ once: true }}
                  whileInView={{ opacity: 1, x: 0 }}
                >
                  <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                    <X className="h-3.5 w-3.5 text-red-400" />
                  </div>
                  <p className="text-[15px] text-foreground/60 leading-relaxed md:text-[17px]">
                    {problem}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* The Solution */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, x: 30 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, x: 0 }}
          >
            <div className="mb-8 inline-flex items-center gap-3 rounded-full bg-amber-500/10 px-5 py-2">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="font-medium text-amber-400 text-sm tracking-wide">
                WITH DROVI
              </span>
            </div>
            <div className="space-y-5">
              {solutions.map((solution, index) => (
                <motion.div
                  className="group flex items-start gap-4"
                  initial={{ opacity: 0, x: 20 }}
                  key={solution}
                  transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                  viewport={{ once: true }}
                  whileInView={{ opacity: 1, x: 0 }}
                >
                  <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                    <CheckCircle2 className="h-4 w-4 text-amber-500" />
                  </div>
                  <p className="text-[15px] text-foreground leading-relaxed md:text-[17px]">
                    {solution}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
