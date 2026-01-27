"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  FileSearch,
  Handshake,
  MessageSquare,
  Scale,
  Search,
  Shield,
  Target,
  Users,
} from "lucide-react";

interface Agent {
  icon: LucideIcon;
  name: string;
  description: string;
}

const agents: Agent[] = [
  {
    icon: MessageSquare,
    name: "Conversations",
    description:
      "Normalized threads and messages across email, chat, docs, and meetings — unified in one schema.",
  },
  {
    icon: Handshake,
    name: "Commitments",
    description:
      "Structured objects with owner, status, due date, and full provenance chain.",
  },
  {
    icon: Scale,
    name: "Decisions",
    description:
      "What was decided, why, and what replaced it — linked to source evidence.",
  },
  {
    icon: Users,
    name: "Entities",
    description:
      "Resolved people, companies, and projects — unified across all sources.",
  },
  {
    icon: Search,
    name: "Query Interface",
    description:
      "Natural language and structured queries. Answers grounded in evidence with citations.",
  },
  {
    icon: Target,
    name: "Ownership",
    description:
      "Who owns what, who promised what, and where work is blocked or waiting.",
  },
  {
    icon: FileSearch,
    name: "Provenance",
    description:
      "Every fact links to its source. Full audit trail for compliance and trust.",
  },
  {
    icon: Shield,
    name: "Risks",
    description:
      "Contradictions, dropped commitments, and policy violations — surfaced automatically.",
  },
];

export function Agents() {
  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-32"
      id="agents"
    >
      {/* Background elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/4 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-br from-amber-500/8 via-orange-500/5 to-transparent blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 h-[600px] w-[600px] translate-x-1/2 rounded-full bg-gradient-to-tl from-amber-600/6 via-transparent to-transparent blur-3xl" />
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
            <span className="relative flex h-1.5 w-1.5 md:h-2 md:w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500 md:h-2 md:w-2" />
            </span>
            <span className="font-medium text-amber-400 text-xs tracking-wide md:text-sm">
              WHAT LIVES IN MEMORY
            </span>
          </div>
          <h2 className="mb-4 font-normal text-[32px] leading-[1.1] tracking-[-1.5px] md:mb-6 md:text-[44px] md:tracking-[-2.2px] lg:text-[56px] lg:tracking-[-2.8px]">
            <span className="text-foreground">Structured intelligence,</span>
            <br />
            <span className="text-foreground/40">not raw data.</span>
          </h2>
          <p className="mx-auto max-w-2xl text-[15px] text-foreground/60 leading-relaxed md:text-[17px]">
            The memory layer doesn't just store information. It extracts,
            resolves, and persists structured knowledge — ready for humans and
            agents to query.
          </p>
        </motion.div>

        {/* Agents grid */}
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {agents.map((agent, index) => (
            <motion.div
              className="group"
              initial={{ opacity: 0, y: 30 }}
              key={agent.name}
              transition={{ duration: 0.5, delay: index * 0.05 }}
              viewport={{ once: true }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="relative h-full overflow-hidden rounded-xl bg-gradient-to-b from-white/[0.03] to-transparent p-4 transition-all duration-300 hover:bg-white/[0.05] md:rounded-2xl md:p-6">
                {/* Subtle top border glow */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {/* Icon */}
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/10 md:mb-5 md:h-12 md:w-12 md:rounded-xl">
                  <agent.icon className="h-5 w-5 text-amber-500 md:h-6 md:w-6" />
                </div>

                {/* Content */}
                <h3 className="mb-1.5 font-medium text-[15px] text-foreground leading-tight md:mb-2 md:text-[17px]">
                  {agent.name}
                </h3>
                <p className="text-[13px] text-foreground/50 leading-relaxed md:text-[14px]">
                  {agent.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
