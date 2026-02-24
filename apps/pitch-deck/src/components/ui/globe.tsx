"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export interface GlobeArcDatum {
  order: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  arcAlt?: number;
  color?: string;
}

export interface GlobeConfig {
  pointSize?: number;
  globeColor?: string;
  showAtmosphere?: boolean;
  atmosphereColor?: string;
  atmosphereAltitude?: number;
  emissive?: string;
  emissiveIntensity?: number;
  shininess?: number;
  polygonColor?: string;
  ambientLight?: string;
  directionalLeftLight?: string;
  directionalTopLight?: string;
  pointLight?: string;
  arcTime?: number;
  arcLength?: number;
  rings?: number;
  maxRings?: number;
  initialPosition?: { lat: number; lng: number };
  autoRotate?: boolean;
  autoRotateSpeed?: number;
}

interface WorldProps {
  data: GlobeArcDatum[];
  globeConfig?: GlobeConfig;
  className?: string;
}

interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

const RADIUS = 41;

function projectPoint(lat: number, lng: number, rotationDeg: number): ProjectedPoint {
  const latRad = (lat * Math.PI) / 180;
  const lngRad = ((lng + rotationDeg) * Math.PI) / 180;

  const x = Math.cos(latRad) * Math.sin(lngRad);
  const y = Math.sin(latRad);
  const z = Math.cos(latRad) * Math.cos(lngRad);

  return {
    x: 50 + x * RADIUS,
    y: 50 - y * RADIUS,
    z,
    visible: z > -0.12,
  };
}

function buildArcPath(start: ProjectedPoint, end: ProjectedPoint, arcAlt = 0.3) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);

  const curvature = Math.min(26, distance * (0.2 + arcAlt * 0.42));
  const controlX = (start.x + end.x) / 2;
  const controlY = (start.y + end.y) / 2 - curvature;

  return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
}

export function World({ data, globeConfig, className }: WorldProps) {
  const {
    pointSize = 4,
    globeColor = "#062056",
    showAtmosphere = true,
    atmosphereColor = "#FFFFFF",
    atmosphereAltitude = 0.1,
    polygonColor = "rgba(255,255,255,0.7)",
    arcTime = 1000,
    initialPosition = { lat: 22.3193, lng: 114.1694 },
    autoRotate = true,
    autoRotateSpeed = 0.5,
  } = globeConfig ?? {};

  const [rotation, setRotation] = useState(initialPosition.lng);

  useEffect(() => {
    if (!autoRotate) {
      return;
    }

    let rafId = 0;

    const tick = () => {
      setRotation((prev) => (prev + autoRotateSpeed * 0.16) % 360);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [autoRotate, autoRotateSpeed]);

  const points = useMemo(() => {
    const keyed = new Map<string, { lat: number; lng: number; color: string }>();

    data.forEach((arc) => {
      const color = arc.color ?? "#3b82f6";

      const startKey = `${arc.startLat}:${arc.startLng}`;
      if (!keyed.has(startKey)) {
        keyed.set(startKey, { lat: arc.startLat, lng: arc.startLng, color });
      }

      const endKey = `${arc.endLat}:${arc.endLng}`;
      if (!keyed.has(endKey)) {
        keyed.set(endKey, { lat: arc.endLat, lng: arc.endLng, color });
      }
    });

    return [...keyed.values()];
  }, [data]);

  const projectedArcs = useMemo(
    () =>
      data.map((arc) => {
        const from = projectPoint(arc.startLat, arc.startLng, rotation);
        const to = projectPoint(arc.endLat, arc.endLng, rotation);
        const path = buildArcPath(from, to, arc.arcAlt ?? 0.3);
        const opacity = from.visible || to.visible ? 0.92 : 0.2;

        return {
          ...arc,
          from,
          to,
          path,
          opacity,
          color: arc.color ?? "#3b82f6",
        };
      }),
    [data, rotation]
  );

  const projectedPoints = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        projected: projectPoint(point.lat, point.lng, rotation),
      })),
    [points, rotation]
  );

  return (
    <div
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-full border border-white/25 shadow-[0_20px_80px_rgba(6,32,86,0.55)]",
        className
      )}
      style={{
        background: `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.12), transparent 34%), radial-gradient(circle at 75% 72%, rgba(6,182,212,0.2), transparent 45%), ${globeColor}`,
      }}
    >
      {showAtmosphere ? (
        <div
          className="pointer-events-none absolute inset-[-12%] rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle, ${atmosphereColor} 0%, transparent 66%)`,
            opacity: atmosphereAltitude + 0.2,
          }}
        />
      ) : null}

      <motion.div
        animate={{ rotate: -rotation }}
        className="pointer-events-none absolute inset-[6%] rounded-full border"
        style={{ borderColor: polygonColor }}
        transition={{ duration: 0, ease: "linear" }}
      />

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
        {[28, 40, 50, 60, 72].map((y) => (
          <line
            key={`lat-${y}`}
            stroke={polygonColor}
            strokeOpacity="0.25"
            strokeWidth="0.35"
            x1="8"
            x2="92"
            y1={y}
            y2={y}
          />
        ))}

        {[26, 38, 50, 62, 74].map((x) => (
          <line
            key={`lng-${x}`}
            stroke={polygonColor}
            strokeOpacity="0.2"
            strokeWidth="0.35"
            x1={x}
            x2={x}
            y1="8"
            y2="92"
          />
        ))}

        {projectedArcs.map((arc) => (
          <g key={`${arc.order}-${arc.startLat}-${arc.startLng}-${arc.endLat}-${arc.endLng}`}>
            <motion.path
              animate={{ pathLength: 1, opacity: arc.opacity }}
              d={arc.path}
              fill="none"
              initial={{ pathLength: 0, opacity: 0.15 }}
              stroke={arc.color}
              strokeLinecap="round"
              strokeWidth="0.58"
              transition={{
                duration: Math.max(0.85, arcTime / 1000),
                delay: arc.order * 0.018,
                ease: "easeOut",
              }}
            />
            <path
              d={arc.path}
              fill="none"
              opacity={arc.opacity * 0.26}
              stroke={arc.color}
              strokeWidth="1.5"
            />
          </g>
        ))}

        {projectedPoints.map(({ color, projected, lat, lng }) =>
          projected.visible ? (
            <g key={`${lat}-${lng}`}>
              <motion.circle
                animate={{ opacity: [0.2, 0.78, 0.2] }}
                cx={projected.x}
                cy={projected.y}
                fill={color}
                initial={{ opacity: 0.2 }}
                r={pointSize * 0.26 + 0.6}
                transition={{
                  duration: 2.3,
                  repeat: Number.POSITIVE_INFINITY,
                  delay: ((lat + lng + 360) % 7) * 0.08,
                }}
              />
              <circle
                cx={projected.x}
                cy={projected.y}
                fill={color}
                r={pointSize * 0.13 + 0.25}
              />
            </g>
          ) : null
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_76%_26%,rgba(255,255,255,0.22),transparent_30%),radial-gradient(circle_at_16%_84%,rgba(99,102,241,0.2),transparent_35%)]" />
    </div>
  );
}
