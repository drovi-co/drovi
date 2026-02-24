import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

interface GeoPoint {
  lat: number;
  lng: number;
}

export interface WorldConnection {
  start: GeoPoint;
  end: GeoPoint;
  color?: string;
}

interface WorldMapProps {
  connections: WorldConnection[];
  className?: string;
}

const WIDTH = 980;
const HEIGHT = 500;

const shapes = [
  "M68,166 L150,134 L237,149 L264,204 L232,264 L172,291 L102,256 L64,219 Z",
  "M208,306 L264,332 L276,398 L246,468 L202,498 L164,444 L173,368 Z",
  "M412,136 L470,114 L542,130 L560,166 L524,200 L470,198 L428,176 Z",
  "M466,206 L536,196 L602,220 L626,272 L610,344 L558,410 L500,430 L462,385 L448,307 Z",
  "M584,150 L662,122 L742,134 L806,176 L838,236 L822,282 L760,298 L712,270 L668,276 L624,230 Z",
  "M754,336 L816,346 L854,386 L834,434 L782,452 L736,420 L722,370 Z",
];

function toXY(point: GeoPoint) {
  return {
    x: ((point.lng + 180) / 360) * WIDTH,
    y: ((90 - point.lat) / 180) * HEIGHT,
  };
}

function getArc(start: GeoPoint, end: GeoPoint) {
  const from = toXY(start);
  const to = toXY(end);

  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const curve = Math.min(175, distance * 0.33 + 34);

  const controlX = (from.x + to.x) / 2;
  const controlY = Math.min(from.y, to.y) - curve;

  return {
    d: `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`,
    from,
    to,
  };
}

const WorldMap = ({ connections, className }: WorldMapProps) => {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl border border-gold/20 bg-[linear-gradient(160deg,hsl(154_28%_11%),hsl(150_32%_5%))] p-3 md:p-5",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(250,204,21,0.14),transparent_40%),radial-gradient(circle_at_88%_100%,rgba(20,184,166,0.16),transparent_42%)]" />

      <svg className="relative z-10 h-auto w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {[...new Array(8)].map((_, idx) => {
          const y = (HEIGHT / 9) * (idx + 1);
          return (
            <line
              key={`lat-${idx}`}
              stroke="rgba(250,204,21,0.1)"
              strokeWidth="1"
              x1="0"
              x2={WIDTH}
              y1={y}
              y2={y}
            />
          );
        })}

        {[...new Array(10)].map((_, idx) => {
          const x = (WIDTH / 11) * (idx + 1);
          return (
            <line
              key={`lng-${idx}`}
              stroke="rgba(250,204,21,0.08)"
              strokeWidth="1"
              x1={x}
              x2={x}
              y1="0"
              y2={HEIGHT}
            />
          );
        })}

        {shapes.map((shape, idx) => (
          <path
            d={shape}
            fill="rgba(245, 158, 11, 0.08)"
            key={shape}
            stroke="rgba(250, 204, 21, 0.2)"
            strokeWidth="1.1"
            style={{ opacity: 0.92 - idx * 0.08 }}
          />
        ))}

        {connections.map((item, idx) => {
          const arc = getArc(item.start, item.end);
          const strokeColor = item.color ?? "#facc15";

          return (
            <g key={`${item.start.lat}-${item.start.lng}-${item.end.lat}-${item.end.lng}`}>
              <motion.path
                animate={{ pathLength: 1, opacity: 1 }}
                d={arc.d}
                fill="none"
                initial={{ pathLength: 0, opacity: 0.2 }}
                stroke={strokeColor}
                strokeLinecap="round"
                strokeWidth="2"
                transition={{ duration: 1.2, delay: idx * 0.14, ease: "easeOut" }}
              />

              <path
                d={arc.d}
                fill="none"
                opacity="0.38"
                stroke={strokeColor}
                strokeWidth="5"
              />

              <circle cx={arc.from.x} cy={arc.from.y} fill={strokeColor} r="4" />
              <circle cx={arc.to.x} cy={arc.to.y} fill={strokeColor} r="4" />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default WorldMap;
