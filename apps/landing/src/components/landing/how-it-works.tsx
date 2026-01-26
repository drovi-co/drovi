"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Database, Inbox, Link2 } from "lucide-react";

interface Step {
  icon: LucideIcon;
  number: string;
  title: string;
  description: string;
}

const steps: Step[] = [
  {
    icon: Link2,
    number: "01",
    title: "Connect Your Sources",
    description:
      "Securely connect email, chat, docs, meetings, and CRM. Drovi backfills history and stays continuously synced — across internal teams and customer conversations.",
  },
  {
    icon: Database,
    number: "02",
    title: "Drovi Builds Your Memory",
    description:
      "Decisions, commitments, owners, deadlines, and context are extracted automatically — then kept up to date as work evolves over time.",
  },
  {
    icon: Inbox,
    number: "03",
    title: "Operate From One System of Record",
    description:
      "One place to see what was decided, promised, and assigned. Every commitment becomes traceable, with context attached and history preserved.",
  },
];

export function HowItWorks() {
  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-32"
      id="how-it-works"
    >
      {/* Background elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-gradient-to-bl from-amber-500/8 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-orange-500/5 via-transparent to-transparent blur-3xl" />
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
              HOW IT WORKS
            </span>
          </div>
          <h2 className="mb-6 font-normal text-[32px] leading-[1.1] tracking-[-1.5px] md:text-[44px] md:tracking-[-2.2px] lg:text-[56px] lg:tracking-[-2.8px]">
            <span className="text-foreground">Connect once.</span>
            <br />
            <span className="text-foreground/40">Memory stays current.</span>
          </h2>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute top-[60px] left-[60px] hidden h-[calc(100%-120px)] w-px bg-gradient-to-b from-amber-500/50 via-amber-500/20 to-transparent lg:block" />

          <div className="space-y-12 md:space-y-16 lg:space-y-24">
            {steps.map((step, index) => (
              <motion.div
                className="group relative"
                initial={{ opacity: 0, y: 40 }}
                key={step.title}
                transition={{ duration: 0.6, delay: index * 0.15 }}
                viewport={{ once: true }}
                whileInView={{ opacity: 1, y: 0 }}
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-16">
                  {/* Number and Icon */}
                  <div className="relative flex shrink-0 items-center gap-4 md:gap-6 lg:w-[120px] lg:flex-col lg:items-center lg:gap-4">
                    {/* Glowing dot on the line */}
                    <div className="absolute top-1/2 left-[60px] hidden h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.5)] lg:block" />

                    {/* Icon container */}
                    <div className="relative flex h-[80px] w-[80px] items-center justify-center md:h-[100px] md:w-[100px] lg:h-[120px] lg:w-[120px]">
                      {/* Outer glow ring */}
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 blur-xl md:rounded-3xl" />
                      {/* Main container */}
                      <div className="relative flex h-full w-full items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent backdrop-blur-sm md:rounded-3xl">
                        <step.icon className="h-8 w-8 text-amber-500 md:h-10 md:w-10 lg:h-12 lg:w-12" />
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-0 lg:pt-2">
                    <div className="mb-2 flex items-baseline gap-4 md:mb-4">
                      <span className="font-medium text-[50px] text-foreground/[0.06] leading-none tracking-[-2px] md:text-[65px] md:tracking-[-3px] lg:text-[80px] lg:tracking-[-4px]">
                        {step.number}
                      </span>
                    </div>
                    <h3 className="-mt-8 mb-3 font-normal text-[22px] text-foreground leading-tight tracking-[-0.5px] md:-mt-10 md:mb-4 md:text-[24px] md:tracking-[-0.8px] lg:-mt-12 lg:text-[28px] lg:tracking-[-1px]">
                      {step.title}
                    </h3>
                    <p className="max-w-lg text-[15px] text-foreground/60 leading-relaxed md:text-[17px]">
                      {step.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
