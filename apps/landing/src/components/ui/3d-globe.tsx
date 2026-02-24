"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export interface GlobeMarker {
  lat: number;
  lng: number;
  src?: string;
  label: string;
}

interface GlobeConfig {
  atmosphereColor?: string;
  atmosphereIntensity?: number;
  autoRotateSpeed?: number;
}

interface Globe3DProps {
  markers: GlobeMarker[];
  config?: GlobeConfig;
  className?: string;
  onMarkerClick?: (marker: GlobeMarker) => void;
  onMarkerHover?: (marker: GlobeMarker | null) => void;
}

interface MarkerProjection {
  marker: GlobeMarker;
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

const RADIUS = 44;

function projectMarker(
  marker: GlobeMarker,
  rotationDeg: number
): MarkerProjection {
  const latRad = (marker.lat * Math.PI) / 180;
  const lngRad = ((marker.lng + rotationDeg) * Math.PI) / 180;

  const x = Math.cos(latRad) * Math.sin(lngRad);
  const y = Math.sin(latRad);
  const z = Math.cos(latRad) * Math.cos(lngRad);

  return {
    marker,
    x: 50 + x * RADIUS,
    y: 50 - y * RADIUS,
    z,
    visible: z > 0,
  };
}

export function Globe3D({
  markers,
  config,
  className,
  onMarkerClick,
  onMarkerHover,
}: Globe3DProps) {
  const [rotation, setRotation] = useState(0);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  const rotateSpeed = config?.autoRotateSpeed ?? 0.28;
  const atmosphereColor = config?.atmosphereColor ?? "#4fd1c5";
  const atmosphereIntensity = config?.atmosphereIntensity ?? 0.55;

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      setRotation((prev) => (prev + rotateSpeed * 0.18) % 360);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [rotateSpeed]);

  const projectedMarkers = useMemo(
    () => markers.map((marker) => projectMarker(marker, rotation)),
    [markers, rotation]
  );

  return (
    <div className={cn("relative aspect-square w-full", className)}>
      <div
        aria-hidden="true"
        className="absolute inset-[-8%] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, ${atmosphereColor} 0%, transparent 68%)`,
          opacity: atmosphereIntensity,
        }}
      />

      <div className="relative h-full w-full overflow-hidden rounded-full border border-white/20 bg-[radial-gradient(circle_at_35%_25%,rgba(125,211,252,0.35),transparent_45%),radial-gradient(circle_at_65%_70%,rgba(20,184,166,0.28),transparent_55%),linear-gradient(160deg,rgba(4,10,18,0.95),rgba(1,4,9,1))] shadow-[0_26px_80px_rgba(8,145,178,0.35)]">
        <motion.div
          animate={{ rotate: -rotation }}
          className="absolute inset-[-35%]"
          transition={{ duration: 0, ease: "linear" }}
        >
          <div className="absolute inset-[20%] rounded-full border border-cyan-200/18" />
          <div className="absolute inset-[26%] rounded-full border border-teal-200/14" />
          <div className="absolute inset-[32%] rounded-full border border-sky-300/10" />

          <div className="absolute top-[50%] left-[14%] h-[1px] w-[72%] bg-gradient-to-r from-transparent via-cyan-100/20 to-transparent" />
          <div className="absolute top-[37%] left-[20%] h-[1px] w-[60%] bg-gradient-to-r from-transparent via-cyan-100/14 to-transparent" />
          <div className="absolute top-[63%] left-[20%] h-[1px] w-[60%] bg-gradient-to-r from-transparent via-cyan-100/12 to-transparent" />

          <div className="absolute top-[14%] left-[50%] h-[72%] w-[1px] -translate-x-1/2 bg-gradient-to-b from-transparent via-cyan-100/20 to-transparent" />
          <div className="absolute top-[20%] left-[38%] h-[60%] w-[1px] bg-gradient-to-b from-transparent via-cyan-100/14 to-transparent" />
          <div className="absolute top-[20%] left-[62%] h-[60%] w-[1px] bg-gradient-to-b from-transparent via-cyan-100/14 to-transparent" />
        </motion.div>

        <div className="pointer-events-none absolute inset-[14%] rounded-full border border-white/10" />

        {projectedMarkers.map(({ marker, x, y, z, visible }) => {
          if (!visible) {
            return null;
          }

          const scale = 0.65 + z * 0.4;
          const opacity = 0.25 + z * 0.75;
          const active = hoveredLabel === marker.label;

          return (
            <button
              aria-label={marker.label}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              key={marker.label}
              onClick={() => onMarkerClick?.(marker)}
              onMouseEnter={() => {
                setHoveredLabel(marker.label);
                onMarkerHover?.(marker);
              }}
              onMouseLeave={() => {
                setHoveredLabel(null);
                onMarkerHover?.(null);
              }}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                opacity,
                transform: `translate(-50%, -50%) scale(${scale})`,
                zIndex: Math.round(z * 100),
              }}
              type="button"
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-cyan-300/30" />
              {marker.src ? (
                <img
                  alt={marker.label}
                  className="relative h-7 w-7 rounded-full border border-cyan-100/45 object-cover shadow-[0_0_18px_rgba(34,211,238,0.45)]"
                  loading="lazy"
                  src={marker.src}
                />
              ) : (
                <span className="relative block h-6 w-6 rounded-full border border-cyan-100/50 bg-cyan-300/35 shadow-[0_0_18px_rgba(34,211,238,0.45)]" />
              )}

              <span
                className={cn(
                  "pointer-events-none absolute top-[120%] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/65 px-2 py-1 text-[10px] text-white/88 tracking-wide transition",
                  active
                    ? "translate-y-0 opacity-100"
                    : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
                )}
              >
                {marker.label}
              </span>
            </button>
          );
        })}

        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_72%_28%,rgba(255,255,255,0.18),transparent_35%),radial-gradient(circle_at_20%_75%,rgba(94,234,212,0.2),transparent_42%)]" />
      </div>
    </div>
  );
}
