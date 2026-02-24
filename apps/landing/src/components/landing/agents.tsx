"use client";

import { motion } from "framer-motion";
import { BookCheck, BrickWall, Cable, FlaskConical, Lightbulb, Search, Waypoints } from "lucide-react";

const ledgerObjects = [
  { icon: Search, label: "Observations" },
  { icon: Lightbulb, label: "Beliefs" },
  { icon: FlaskConical, label: "Hypotheses" },
  { icon: BrickWall, label: "Constraints" },
  { icon: Waypoints, label: "Causal relationships" },
  { icon: BookCheck, label: "Intervention records" },
  { icon: Cable, label: "Outcomes" },
];

export function Agents() {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[860px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber-500/8 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-10 text-center md:mb-12"
          initial={{ opacity: 0, y: 22 }}
          transition={{ duration: 0.62 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            What Lives in the Ledger
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.06] tracking-[-1.5px] md:text-[52px] md:tracking-[-2.4px]">
            Drovi does not store documents.
            <br />
            <span className="text-foreground/48">
              It stores structured institutional intelligence.
            </span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ledgerObjects.map((item, index) => (
            <motion.div
              className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5"
              initial={{ opacity: 0, y: 18 }}
              key={item.label}
              transition={{ duration: 0.45, delay: index * 0.05 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/14 text-amber-300">
                <item.icon className="h-5 w-5" />
              </div>
              <p className="text-[16px] text-foreground/85 leading-snug">{item.label}</p>
            </motion.div>
          ))}
        </div>

        <p className="mt-6 text-center text-[15px] text-foreground/72 leading-relaxed md:text-[17px]">
          All evidence-linked. All time-scoped.
        </p>
      </div>
    </section>
  );
}
