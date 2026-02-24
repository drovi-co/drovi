"use client";

import { motion } from "framer-motion";

import { Globe3D, type GlobeMarker } from "@/components/ui/3d-globe";
import WorldMap from "@/components/ui/world-map";

interface WorldBrainSignalProps {
  onRequestAccess?: () => void;
}

const worldTwinSignals = [
  "Internal commitments and dependencies",
  "External regulatory, market, legal, scientific, geopolitical signals",
  "Exposure pathways linking the two",
];

const worldMapDots = [
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

export function WorldBrainSignal({ onRequestAccess }: WorldBrainSignalProps) {
  return (
    <section
      className="relative overflow-hidden px-6 py-20 md:py-28"
      id="world-brain"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[960px] w-[960px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-sky-500/10 via-transparent to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          className="mb-12 text-center"
          initial={{ opacity: 0, y: 22 }}
          transition={{ duration: 0.62 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <p className="text-amber-400/85 text-xs uppercase tracking-[0.2em] md:text-sm">
            World Brain
          </p>
          <h2 className="mt-4 font-normal text-[34px] leading-[1.06] tracking-[-1.5px] md:text-[52px] md:tracking-[-2.4px]">
            Not Stored Memory.
            <br />
            <span className="text-foreground/48">A Live World Model.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-[15px] text-foreground/68 leading-relaxed md:text-[18px]">
            World Brain extends Drovi from recordkeeping into institutional
            cognition.
          </p>
          <p className="mx-auto mt-3 max-w-3xl text-[15px] text-foreground/62 leading-relaxed md:text-[17px]">
            It builds a continuously updated world twin for each organization.
          </p>
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-2">
          <motion.div
            className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7"
            initial={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.55 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, x: 0 }}
          >
            <Globe3D
              className="h-[320px] md:h-[420px]"
              config={{
                atmosphereColor: "#4da6ff",
                atmosphereIntensity: 20,
                bumpScale: 5,
                autoRotateSpeed: 0.3,
              }}
              markers={globeMarkers}
            />
          </motion.div>

          <motion.div
            className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7"
            initial={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.55, delay: 0.04 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, x: 0 }}
          >
            <WorldMap dots={worldMapDots} />
          </motion.div>
        </div>

        <motion.div
          className="mt-6 rounded-3xl border border-amber-400/20 bg-gradient-to-b from-amber-500/[0.08] to-transparent p-6 md:p-8"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.55, delay: 0.06 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          <ul className="space-y-3">
            {worldTwinSignals.map((signal) => (
              <li
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-[15px] text-foreground/84 leading-relaxed md:text-[16px]"
                key={signal}
              >
                {signal}
              </li>
            ))}
          </ul>

          <p className="mt-5 text-[16px] text-foreground/78 leading-relaxed md:text-[18px]">
            When something changes in the world, the twin updates. Before you
            react, it has already computed impact.
          </p>

          <button
            className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 font-medium text-black transition hover:bg-white/90"
            onClick={onRequestAccess}
            type="button"
          >
            Request Private Briefing
          </button>
        </motion.div>
      </div>
    </section>
  );
}
