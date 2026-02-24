"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { DemoModal } from "@/components/landing/demo-modal";
import { Footer } from "@/components/landing/footer";
import { Navigation } from "@/components/landing/navigation";
import { Globe3D, type GlobeMarker } from "@/components/ui/3d-globe";
import WorldMap from "@/components/ui/world-map";
import { WaitlistDialog } from "@/components/waitlist/waitlist-dialog";

const howItWorksSteps = [
  {
    title: "1. Observe",
    description:
      "Global feeds. Legal updates. Market moves. Research. Court rulings. Internal systems. Communications. Documents. Contracts.",
  },
  {
    title: "2. Normalize",
    description: "All signals become structured observations.",
  },
  {
    title: "3. Update Beliefs",
    description: "Propositions transition through explicit epistemic states.",
  },
  {
    title: "4. Compute Impact",
    description: "Causal pathways map external change to internal exposure.",
  },
  {
    title: "5. Propose Intervention",
    description: "Governed, policy-aware action plans with rollback logic.",
  },
];

const liveSurfaces = [
  {
    title: "Belief Drift Radar",
    description: "Where assumptions are decaying against new evidence.",
  },
  {
    title: "Counterfactual Lab",
    description: "Compare action paths before execution.",
  },
  {
    title: "Obligation Sentinel",
    description: "Detect conflict before breach.",
  },
  {
    title: "Temporal Ledger",
    description: "Reconstruct what was believed, when, and why.",
  },
];

const reductionItems = [
  "Surprise",
  "Silent liability",
  "Assumption drift",
  "Delayed reaction",
];

const increaseItems = [
  "Institutional awareness",
  "Response precision",
  "Accountability",
  "Strategic foresight",
];

const heroMapDots = [
  {
    start: { lat: 64.2008, lng: -149.4937 },
    end: { lat: 34.0522, lng: -118.2437 },
  },
  {
    start: { lat: 64.2008, lng: -149.4937 },
    end: { lat: -15.7975, lng: -47.8919 },
  },
  {
    start: { lat: -15.7975, lng: -47.8919 },
    end: { lat: 38.7223, lng: -9.1393 },
  },
  {
    start: { lat: 51.5074, lng: -0.1278 },
    end: { lat: 28.6139, lng: 77.209 },
  },
  {
    start: { lat: 28.6139, lng: 77.209 },
    end: { lat: 43.1332, lng: 131.9113 },
  },
  {
    start: { lat: 28.6139, lng: 77.209 },
    end: { lat: -1.2921, lng: 36.8219 },
  },
];

const pressureMapDots = [
  {
    start: { lat: 64.2008, lng: -149.4937 },
    end: { lat: 34.0522, lng: -118.2437 },
  },
  {
    start: { lat: 64.2008, lng: -149.4937 },
    end: { lat: -15.7975, lng: -47.8919 },
  },
  {
    start: { lat: -15.7975, lng: -47.8919 },
    end: { lat: 38.7223, lng: -9.1393 },
  },
  {
    start: { lat: 51.5074, lng: -0.1278 },
    end: { lat: 28.6139, lng: 77.209 },
  },
  {
    start: { lat: 28.6139, lng: 77.209 },
    end: { lat: 43.1332, lng: 131.9113 },
  },
  {
    start: { lat: 28.6139, lng: 77.209 },
    end: { lat: -1.2921, lng: 36.8219 },
  },
];

const globeMarkers: GlobeMarker[] = [
  {
    lat: 40.7128,
    lng: -74.006,
    src: "https://assets.aceternity.com/avatars/1.webp",
    label: "New York",
  },
  {
    lat: 51.5074,
    lng: -0.1278,
    src: "https://assets.aceternity.com/avatars/2.webp",
    label: "London",
  },
  {
    lat: 35.6762,
    lng: 139.6503,
    src: "https://assets.aceternity.com/avatars/3.webp",
    label: "Tokyo",
  },
  {
    lat: -33.8688,
    lng: 151.2093,
    src: "https://assets.aceternity.com/avatars/4.webp",
    label: "Sydney",
  },
  {
    lat: 48.8566,
    lng: 2.3522,
    src: "https://assets.aceternity.com/avatars/5.webp",
    label: "Paris",
  },
  {
    lat: 28.6139,
    lng: 77.209,
    src: "https://assets.aceternity.com/avatars/6.webp",
    label: "New Delhi",
  },
  {
    lat: 55.7558,
    lng: 37.6173,
    src: "https://assets.aceternity.com/avatars/7.webp",
    label: "Moscow",
  },
  {
    lat: -22.9068,
    lng: -43.1729,
    src: "https://assets.aceternity.com/avatars/8.webp",
    label: "Rio de Janeiro",
  },
  {
    lat: 31.2304,
    lng: 121.4737,
    src: "https://assets.aceternity.com/avatars/9.webp",
    label: "Shanghai",
  },
  {
    lat: 25.2048,
    lng: 55.2708,
    src: "https://assets.aceternity.com/avatars/10.webp",
    label: "Dubai",
  },
  {
    lat: -34.6037,
    lng: -58.3816,
    src: "https://assets.aceternity.com/avatars/11.webp",
    label: "Buenos Aires",
  },
  {
    lat: 1.3521,
    lng: 103.8198,
    src: "https://assets.aceternity.com/avatars/12.webp",
    label: "Singapore",
  },
  {
    lat: 37.5665,
    lng: 126.978,
    src: "https://assets.aceternity.com/avatars/13.webp",
    label: "Seoul",
  },
];

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

        <section className="relative min-h-screen w-full overflow-hidden rounded-[20px]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute top-1/2 left-1/2 w-[250%] -translate-x-1/2 -translate-y-1/2 scale-[2.05] md:w-[190%] md:scale-[1.75] lg:w-[165%] lg:scale-[1.45]">
                <WorldMap dots={heroMapDots} />
              </div>
            </div>
            <div className="absolute inset-0 bg-black/50" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(183,99,7,0.28),transparent_34%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.2),transparent_32%)]" />
          </div>

          <motion.div
            className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1440px] items-center justify-center px-6 pt-28 pb-16 text-center md:px-[80px] md:pt-[148px] md:pb-[80px]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mx-auto max-w-5xl">
              <p className="text-amber-300/90 text-xs uppercase tracking-[0.22em] md:text-sm">
                Drovi World Brain
              </p>
              <h1 className="mt-5 font-normal text-[42px] text-white leading-[0.98] tracking-[-1.9px] md:text-[70px] md:tracking-[-3.6px]">
                Institutional Cognition for High-Consequence Teams
              </h1>
              <p className="mx-auto mt-5 max-w-3xl text-[15px] text-white/80 leading-relaxed md:text-[18px]">
                World Brain continuously fuses global and internal signals into
                evidence-backed beliefs, exposure maps, causal impact chains,
                and governed interventions.
              </p>
              <p className="mx-auto mt-3 max-w-2xl text-[15px] text-white/68 leading-relaxed md:text-[17px]">
                It does not summarize the world. It models it.
              </p>

              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button
                  className="rounded-full bg-white px-7 py-3.5 font-medium text-black transition hover:bg-white/92"
                  onClick={handleRequestAccess}
                  type="button"
                >
                  Request Private Briefing
                </button>
                <button
                  className="rounded-full border border-white/20 bg-white/8 px-7 py-3.5 text-white/90 transition hover:bg-white/15"
                  onClick={() => setDemoOpen(true)}
                  type="button"
                >
                  View Control Room
                </button>
              </div>
            </div>
          </motion.div>
        </section>
      </div>

      <section className="relative overflow-hidden px-6 py-20 md:py-24">
        <div className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 md:p-8">
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            What It Means
          </p>
          <h2 className="mt-4 font-normal text-[32px] leading-[1.06] tracking-[-1.5px] md:text-[48px] md:tracking-[-2px]">
            A Live Institutional World Twin
          </h2>
          <p className="mt-4 text-[15px] text-foreground/68 leading-relaxed md:text-[17px]">
            Every organization operates inside a changing external environment.
          </p>
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              "Your internal state",
              "Your commitments",
              "Your obligations",
              "Your counterparties",
              "The regulatory and market landscape around you",
            ].map((item) => (
              <li
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-foreground/78 md:text-[15px]"
                key={item}
              >
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[15px] text-foreground/78 leading-relaxed md:text-[17px]">
            When the external state shifts, your internal twin recalculates.
          </p>
        </div>
      </section>

      <section className="relative overflow-hidden px-6 py-20 md:py-24" id="how-it-works">
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
              How It Works
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {howItWorksSteps.map((step, index) => (
              <motion.article
                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5"
                initial={{ opacity: 0, y: 18 }}
                key={step.title}
                transition={{ duration: 0.45, delay: index * 0.06 }}
                viewport={{ once: true }}
                whileInView={{ opacity: 1, y: 0 }}
              >
                <h3 className="text-[18px] leading-tight">{step.title}</h3>
                <p className="mt-2 text-[14px] text-foreground/66 leading-relaxed">
                  {step.description}
                </p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 text-center">
            <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
              Live Surfaces
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7">
              <h3 className="text-[21px] tracking-[-0.4px] md:text-[24px]">World Pressure Map</h3>
              <p className="mt-2 text-[14px] text-foreground/66 leading-relaxed md:text-[15px]">
                Where external pressure is rising against your exposure graph.
              </p>
              <div className="mt-6">
                <WorldMap dots={pressureMapDots} />
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7">
              <h3 className="text-[21px] tracking-[-0.4px] md:text-[24px]">Institutional World Twin</h3>
              <p className="mt-2 text-[14px] text-foreground/66 leading-relaxed md:text-[15px]">
                Live context for global state, internal commitments, and cross-system exposure.
              </p>
              <Globe3D
                className="mt-6 h-[320px] md:h-[420px]"
                config={{
                  atmosphereColor: "#4da6ff",
                  atmosphereIntensity: 20,
                  bumpScale: 5,
                  autoRotateSpeed: 0.3,
                }}
                markers={globeMarkers}
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {liveSurfaces.map((surface, index) => (
              <motion.article
                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5"
                initial={{ opacity: 0, y: 16 }}
                key={surface.title}
                transition={{ duration: 0.45, delay: index * 0.06 }}
                viewport={{ once: true }}
                whileInView={{ opacity: 1, y: 0 }}
              >
                <h4 className="text-[18px]">{surface.title}</h4>
                <p className="mt-2 text-[14px] text-foreground/66 leading-relaxed md:text-[15px]">
                  {surface.description}
                </p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-6 py-20 md:py-24" id="security">
        <div className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-gradient-to-b from-amber-500/[0.08] to-transparent p-6 md:p-8">
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            Why It Matters
          </p>
          <h2 className="mt-4 font-normal text-[32px] leading-[1.08] tracking-[-1.4px] md:text-[48px] md:tracking-[-2px]">
            Institutions do not collapse from missing information.
            <br />
            <span className="text-foreground/48">
              They collapse from miscalculated exposure.
            </span>
          </h2>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <p className="text-foreground/74 text-xs uppercase tracking-[0.16em]">
                World Brain reduces
              </p>
              <ul className="mt-3 space-y-2 text-[14px] text-foreground/78 md:text-[15px]">
                {reductionItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <p className="text-foreground/74 text-xs uppercase tracking-[0.16em]">
                World Brain increases
              </p>
              <ul className="mt-3 space-y-2 text-[14px] text-foreground/78 md:text-[15px]">
                {increaseItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-6 py-20 md:py-28">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-normal text-[34px] leading-[1.08] tracking-[-1.5px] md:text-[54px] md:tracking-[-2.6px]">
            Drovi is not a dashboard.
            <br />
            <span className="text-foreground/48">
              It is an institutional early warning system.
            </span>
          </h2>
          <button
            className="mt-8 inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 font-medium text-black transition hover:bg-white/92"
            onClick={handleRequestAccess}
            type="button"
          >
            Request Private Briefing
          </button>
          <p className="mt-5 text-[12px] text-foreground/45 md:text-[14px]">
            Security Review • Structured Onboarding
          </p>
        </div>
      </section>

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
