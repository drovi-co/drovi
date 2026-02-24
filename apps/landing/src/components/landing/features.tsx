"use client";

import { motion } from "framer-motion";
import { Building2 } from "lucide-react";

const infrastructureBullets = [
  "Multi-source ingestion",
  "Real-time sync",
  "Historical backfill",
  "Graph-based exposure modeling",
  "Agent-ready APIs",
  "Full audit and custody",
];

export function Features() {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28" id="security">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[760px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-10 text-center md:mb-12"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            Built for Institutions
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.06] tracking-[-1.5px] md:text-[52px] md:tracking-[-2.4px]">
            Drovi is infrastructure.
          </h2>
        </motion.div>

        <motion.div
          className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 md:p-8"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.55, delay: 0.04 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {infrastructureBullets.map((bullet) => (
              <div
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[15px] text-foreground/82 leading-relaxed md:text-[16px]"
                key={bullet}
              >
                {bullet}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] p-5">
            <p className="inline-flex items-center gap-2 text-amber-300 text-xs tracking-[0.16em] uppercase">
              <Building2 className="h-4 w-4" />
              Designed for high-consequence teams
            </p>
            <p className="mt-3 text-[15px] text-foreground/78 leading-relaxed md:text-[17px]">
              Designed for legal firms, family offices, hedge funds, financial
              institutions, and high-consequence teams.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
