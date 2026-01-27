"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Brain, Clock, Gauge, Handshake, Layers, Network } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  size: "normal" | "large";
}

const features: Feature[] = [
  {
    icon: Layers,
    title: "Universal Connectors",
    description:
      "Ingest from email, chat, docs, meetings, CRM, and custom sources. One ingestion layer for all your data.",
    size: "large",
  },
  {
    icon: Handshake,
    title: "Entity Resolution",
    description:
      "Unified identities across sources. The same person, project, or commitment is recognized everywhere.",
    size: "normal",
  },
  {
    icon: Network,
    title: "Knowledge Graph",
    description:
      "Relationships, decisions, and commitments stored in a queryable graph with full provenance.",
    size: "normal",
  },
  {
    icon: Brain,
    title: "Agent-Ready APIs",
    description:
      "Structured endpoints for AI agents to read and write memory. Your agents operate on the same truth.",
    size: "large",
  },
  {
    icon: Clock,
    title: "Historical Backfill",
    description:
      "Import years of history. Memory starts from day one, not after weeks of usage.",
    size: "large",
  },
  {
    icon: Gauge,
    title: "Real-Time Sync",
    description:
      "Continuous ingestion keeps memory current. Changes propagate in seconds, not hours.",
    size: "normal",
  },
];

export function Features() {
  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-32"
      id="features"
    >
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber-500/5 via-transparent to-transparent blur-3xl" />
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
              INFRASTRUCTURE CAPABILITIES
            </span>
          </div>
          <h2 className="mb-4 font-normal text-[32px] leading-[1.1] tracking-[-1.5px] md:mb-6 md:text-[44px] md:tracking-[-2.2px] lg:text-[56px] lg:tracking-[-2.8px]">
            <span className="text-foreground">Built for scale.</span>
            <br />
            <span className="text-foreground/40">Ready for agents.</span>
          </h2>
          <p className="mx-auto max-w-2xl text-[15px] text-foreground/60 leading-relaxed md:text-[17px]">
            The memory layer is infrastructure — not an app. Designed to serve
            humans, agents, and systems at enterprise scale.
          </p>
        </motion.div>

        {/* Bento grid */}
        <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
          {features.map((feature, index) => (
            <motion.div
              className={`group ${feature.size === "large" ? "md:col-span-2" : ""}`}
              initial={{ opacity: 0, y: 30 }}
              key={feature.title}
              transition={{ duration: 0.5, delay: index * 0.08 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="relative h-full overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-5 transition-all duration-300 hover:from-white/[0.06] hover:to-white/[0.02] md:rounded-3xl md:p-8">
                {/* Subtle border effect */}
                <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/[0.05] ring-inset md:rounded-3xl" />

                {/* Hover glow */}
                <div className="absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-amber-500/20 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />

                {/* Content */}
                <div className="relative">
                  {/* Icon */}
                  <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 md:mb-6 md:h-14 md:w-14 md:rounded-2xl">
                    <feature.icon className="h-5 w-5 text-amber-500 md:h-7 md:w-7" />
                  </div>

                  <h3 className="mb-2 font-medium text-[18px] text-foreground leading-tight tracking-[-0.3px] md:mb-3 md:text-[22px] md:tracking-[-0.5px]">
                    {feature.title}
                  </h3>
                  <p
                    className={`text-[14px] text-foreground/50 leading-relaxed md:text-[16px] ${feature.size === "large" ? "md:max-w-lg" : ""}`}
                  >
                    {feature.description}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
