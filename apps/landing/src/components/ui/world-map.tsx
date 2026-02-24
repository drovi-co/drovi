"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

interface GeoPoint {
  lat: number;
  lng: number;
}

interface ConnectionDot {
  start: GeoPoint;
  end: GeoPoint;
  color?: string;
}

interface WorldMapProps {
  dots: ConnectionDot[];
  className?: string;
}

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 520;

const continents = [
  "M70,170 L150,135 L235,150 L262,205 L230,265 L172,290 L104,258 L65,220 Z",
  "M210,305 L262,330 L274,396 L246,466 L204,500 L165,446 L175,368 Z",
  "M416,138 L470,116 L542,130 L560,166 L525,200 L472,198 L430,176 Z",
  "M466,206 L538,196 L602,220 L625,272 L610,346 L560,410 L502,430 L462,385 L448,308 Z",
  "M584,152 L662,122 L742,134 L805,176 L838,235 L825,282 L760,297 L714,270 L670,275 L626,230 Z",
  "M756,334 L815,345 L854,385 L835,432 L782,452 L736,420 L724,370 Z",
];

function toXY(point: GeoPoint) {
  return {
    x: ((point.lng + 180) / 360) * MAP_WIDTH,
    y: ((90 - point.lat) / 180) * MAP_HEIGHT,
  };
}

function createArcPath(start: GeoPoint, end: GeoPoint) {
  const from = toXY(start);
  const to = toXY(end);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  const curvature = Math.min(185, distance * 0.34 + 36);
  const controlX = (from.x + to.x) / 2;
  const controlY = Math.min(from.y, to.y) - curvature;

  return {
    d: `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`,
    from,
    to,
  };
}

export default function WorldMap({ dots, className }: WorldMapProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-[32px] border border-cyan-100/15 bg-[linear-gradient(160deg,rgba(7,16,28,0.95),rgba(2,8,16,1))] p-4 shadow-[0_26px_90px_rgba(8,145,178,0.24)] md:p-6",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(45,212,191,0.14),transparent_38%),radial-gradient(circle_at_82%_100%,rgba(56,189,248,0.1),transparent_42%)]" />

      <svg
        className="relative z-10 h-auto w-full"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      >
        <defs>
          <filter id="worldGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {[...new Array(8)].map((_, index) => {
          const y = (MAP_HEIGHT / 9) * (index + 1);
          return (
            <line
              key={`latitude-${index}`}
              stroke="rgba(148, 163, 184, 0.12)"
              strokeWidth="1"
              x1="0"
              x2={MAP_WIDTH}
              y1={y}
              y2={y}
            />
          );
        })}

        {[...new Array(10)].map((_, index) => {
          const x = (MAP_WIDTH / 11) * (index + 1);
          return (
            <line
              key={`longitude-${index}`}
              stroke="rgba(148, 163, 184, 0.09)"
              strokeWidth="1"
              x1={x}
              x2={x}
              y1="0"
              y2={MAP_HEIGHT}
            />
          );
        })}

        {continents.map((path, index) => (
          <path
            d={path}
            fill="rgba(56, 189, 248, 0.12)"
            key={path}
            stroke="rgba(125, 211, 252, 0.22)"
            strokeWidth="1.2"
            style={{ opacity: 0.86 - index * 0.08 }}
          />
        ))}

        {dots.map((dot, index) => {
          const color = dot.color ?? "#22d3ee";
          const arc = createArcPath(dot.start, dot.end);

          return (
            <g key={`${dot.start.lat}-${dot.start.lng}-${dot.end.lat}-${dot.end.lng}`}>
              <motion.path
                animate={{ pathLength: 1, opacity: 1 }}
                d={arc.d}
                fill="none"
                initial={{ pathLength: 0, opacity: 0.3 }}
                stroke={color}
                strokeLinecap="round"
                strokeWidth="2"
                transition={{
                  duration: 1.4,
                  delay: index * 0.14,
                  ease: "easeOut",
                }}
              />

              <path
                d={arc.d}
                fill="none"
                filter="url(#worldGlow)"
                opacity="0.45"
                stroke={color}
                strokeWidth="6"
              />

              <circle cx={arc.from.x} cy={arc.from.y} fill={color} r="4.5" />
              <circle cx={arc.to.x} cy={arc.to.y} fill={color} r="4.5" />

              <motion.circle
                animate={{ opacity: [0.1, 0.6, 0.1], r: [4, 11, 4] }}
                cx={arc.to.x}
                cy={arc.to.y}
                fill={color}
                initial={{ opacity: 0.2, r: 4 }}
                transition={{
                  duration: 2,
                  repeat: Number.POSITIVE_INFINITY,
                  repeatDelay: 0.25,
                  delay: index * 0.2,
                }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
