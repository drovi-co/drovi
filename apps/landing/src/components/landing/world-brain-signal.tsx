"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowUpRight, ShieldCheck, Waves } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { Globe3D, type GlobeMarker } from "@/components/ui/3d-globe";
import WorldMap from "@/components/ui/world-map";

const markers: GlobeMarker[] = [
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
    lat: 28.6139,
    lng: 77.209,
    src: "https://assets.aceternity.com/avatars/6.webp",
    label: "New Delhi",
  },
  {
    lat: -22.9068,
    lng: -43.1729,
    src: "https://assets.aceternity.com/avatars/8.webp",
    label: "Rio de Janeiro",
  },
  {
    lat: 1.3521,
    lng: 103.8198,
    src: "https://assets.aceternity.com/avatars/12.webp",
    label: "Singapore",
  },
];

const outcomeBullets = [
  "Models beliefs with explicit epistemic states.",
  "Computes pressure bridges from world to operations.",
  "Governs interventions with policy and rollback logic.",
];

const entranceEase = [0.22, 1, 0.36, 1] as const;

const headerVariants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.72,
      ease: entranceEase,
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
};

const headerItemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.62, ease: entranceEase } },
};

interface WorldBrainSignalProps {
  onRequestAccess?: () => void;
}

export function WorldBrainSignal({ onRequestAccess }: WorldBrainSignalProps) {
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 85%", "end 15%"],
  });
  const smoothedProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    mass: 0.3,
  });

  const glowY = useTransform(smoothedProgress, [0, 1], [72, -68]);
  const glowOpacity = useTransform(smoothedProgress, [0, 0.35, 1], [0.28, 0.9, 0.45]);
  const leftColumnY = useTransform(smoothedProgress, [0, 1], [14, -18]);
  const rightColumnY = useTransform(smoothedProgress, [0, 1], [24, -10]);

  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-28"
      id="world-brain"
      ref={sectionRef}
    >
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute top-0 left-1/2 h-[860px] w-[860px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl"
          style={
            reduceMotion
              ? undefined
              : {
                  y: glowY,
                  opacity: glowOpacity,
                }
          }
        />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-10 text-center md:mb-14"
          initial="hidden"
          variants={headerVariants}
          viewport={{ once: true }}
          whileInView="show"
        >
          <motion.p
            className="text-amber-400/80 text-xs tracking-[0.22em] uppercase md:text-sm"
            variants={headerItemVariants}
          >
            New: World Brain
          </motion.p>
          <motion.h2
            className="mt-4 font-normal text-[34px] leading-[1.05] tracking-[-1.5px] md:text-[56px] md:tracking-[-2.8px]"
            variants={headerItemVariants}
          >
            A live institutional world model,
            <br />
            not just stored memory.
          </motion.h2>
          <motion.p
            className="mx-auto mt-4 max-w-3xl text-[15px] text-foreground/62 leading-relaxed md:text-[17px]"
            variants={headerItemVariants}
          >
            World Brain extends Drovi from memory infrastructure into
            institutional cognition: evidence-backed beliefs, causal pressure,
            and governed intervention logic.
          </motion.p>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.div
            className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7"
            initial={{ opacity: 0, x: -28 }}
            style={reduceMotion ? undefined : { y: leftColumnY }}
            transition={{ duration: 0.75, ease: entranceEase }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, x: 0 }}
            whileHover={{ y: -4 }}
          >
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-2 text-amber-300 text-xs tracking-[0.14em] uppercase">
              <Waves className="h-4 w-4" />
              Institutional world twin
            </div>

            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
              transition={{
                duration: 5.2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut",
              }}
            >
              <Globe3D
                className="mx-auto max-w-[500px]"
                config={{
                  atmosphereColor: "#4da6ff",
                  atmosphereIntensity: 0.58,
                  autoRotateSpeed: 0.3,
                }}
                markers={markers}
              />
            </motion.div>

            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 transition-colors hover:border-white/20 hover:bg-black/30">
                <p className="text-foreground/42 text-xs uppercase tracking-[0.18em]">
                  Temporal accountability
                </p>
                <p className="mt-2 text-foreground/72 text-sm leading-relaxed">
                  What was believed, when, and why.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 transition-colors hover:border-white/20 hover:bg-black/30">
                <p className="text-foreground/42 text-xs uppercase tracking-[0.18em]">
                  Evidence custody
                </p>
                <p className="mt-2 text-foreground/72 text-sm leading-relaxed">
                  Every high-stakes state has source-grounded support.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            className="flex flex-col gap-4"
            initial={{ opacity: 0, x: 28 }}
            style={reduceMotion ? undefined : { y: rightColumnY }}
            transition={{ duration: 0.75, delay: 0.05, ease: entranceEase }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, x: 0 }}
          >
            <motion.div
              className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7"
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              whileHover={{ y: -4 }}
            >
              <WorldMap
                dots={[
                  {
                    start: { lat: 64.2008, lng: -149.4937 },
                    end: { lat: 34.0522, lng: -118.2437 },
                    color: "#34d399",
                  },
                  {
                    start: { lat: 34.0522, lng: -118.2437 },
                    end: { lat: 51.5074, lng: -0.1278 },
                    color: "#22d3ee",
                  },
                  {
                    start: { lat: 51.5074, lng: -0.1278 },
                    end: { lat: 28.6139, lng: 77.209 },
                    color: "#0ea5e9",
                  },
                  {
                    start: { lat: 28.6139, lng: 77.209 },
                    end: { lat: -1.2921, lng: 36.8219 },
                    color: "#5eead4",
                  },
                  {
                    start: { lat: -1.2921, lng: 36.8219 },
                    end: { lat: -15.7975, lng: -47.8919 },
                    color: "#67e8f9",
                  },
                ]}
              />

              <p className="mt-4 text-foreground/58 text-sm leading-relaxed">
                External signals are mapped to exposure paths before they become
                operational surprises.
              </p>
            </motion.div>

            <motion.div
              className="rounded-3xl border border-white/10 bg-gradient-to-b from-amber-500/[0.08] to-transparent p-5 md:p-7"
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              whileHover={{ y: -4 }}
            >
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-1 text-foreground/70 text-xs uppercase tracking-[0.14em]">
                <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
                World Brain outcomes
              </p>

              <div className="space-y-3">
                {outcomeBullets.map((bullet, index) => (
                  <motion.p
                    className="text-[15px] text-foreground/85 leading-relaxed"
                    initial={{ opacity: 0, x: -12 }}
                    key={bullet}
                    transition={{ duration: 0.4, delay: index * 0.08 }}
                    viewport={{ once: true }}
                    whileInView={{ opacity: 1, x: 0 }}
                  >
                    {bullet}
                  </motion.p>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 font-medium text-black transition hover:bg-white/90"
                  onClick={onRequestAccess}
                  type="button"
                >
                  Brief the team
                </button>
                <Link
                  className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/12 px-5 py-2.5 text-foreground/82 transition hover:bg-white/8"
                  href="/world-brain"
                >
                  Open World Brain page
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
