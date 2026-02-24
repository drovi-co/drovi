"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { CTA } from "@/components/landing/cta";
import { DemoModal } from "@/components/landing/demo-modal";
import { Footer } from "@/components/landing/footer";
import { Navigation } from "@/components/landing/navigation";
import { WorldBrainCapabilities } from "@/components/landing/world-brain-capabilities";
import { WorldBrainSignal } from "@/components/landing/world-brain-signal";
import { WaitlistDialog } from "@/components/waitlist/waitlist-dialog";

const entranceEase = [0.22, 1, 0.36, 1] as const;

export default function WorldBrainPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const handleRequestAccess = () => {
    setDemoOpen(false);
    setWaitlistOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <div className="relative">
        <Navigation onRequestAccess={handleRequestAccess} />

        <section className="relative overflow-hidden px-6 pt-28 pb-16 md:pt-36 md:pb-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(183,99,7,0.28),transparent_34%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.16),transparent_28%)]" />

          <motion.div
            className="relative mx-auto max-w-5xl text-center"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: entranceEase, staggerChildren: 0.08 }}
          >
            <motion.p
              className="text-amber-400/80 text-xs uppercase tracking-[0.2em] md:text-sm"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.58, ease: entranceEase }}
            >
              Drovi World Brain
            </motion.p>
            <motion.h1
              className="mt-5 font-normal text-[44px] leading-[0.98] tracking-[-2px] md:text-[72px] md:tracking-[-3.8px]"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.66, ease: entranceEase, delay: 0.05 }}
            >
              Institutional cognition for high-consequence teams.
            </motion.h1>
            <motion.p
              className="mx-auto mt-5 max-w-3xl text-[15px] text-foreground/68 leading-relaxed md:text-[19px]"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: entranceEase, delay: 0.12 }}
            >
              World Brain continuously fuses global and internal signals into
              evidence-backed beliefs, causal pressure maps, and governed
              interventions.
            </motion.p>

            <motion.div
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.58, ease: entranceEase, delay: 0.18 }}
            >
              <button
                className="rounded-full bg-white px-7 py-3.5 font-medium text-black transition hover:bg-white/92"
                onClick={handleRequestAccess}
                type="button"
              >
                Request private briefing
              </button>
              <button
                className="rounded-full border border-white/15 bg-white/6 px-7 py-3.5 text-foreground/88 transition hover:bg-white/12"
                onClick={() => setDemoOpen(true)}
                type="button"
              >
                Watch control room
              </button>
            </motion.div>
          </motion.div>
        </section>
      </div>

      <WorldBrainSignal onRequestAccess={handleRequestAccess} />
      <WorldBrainCapabilities />
      <CTA onRequestAccess={handleRequestAccess} />
      <Footer />

      <WaitlistDialog onOpenChange={setWaitlistOpen} open={waitlistOpen} />
      <DemoModal
        onOpenChange={setDemoOpen}
        onRequestAccess={handleRequestAccess}
        open={demoOpen}
      />
    </div>
  );
}
