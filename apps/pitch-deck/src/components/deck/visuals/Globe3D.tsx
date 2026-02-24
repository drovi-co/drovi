import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export interface GlobeMarker {
  lat: number;
  lng: number;
  label: string;
}

interface Globe3DProps {
  markers: GlobeMarker[];
  className?: string;
  rotationSpeed?: number;
}

interface ProjectedMarker {
  marker: GlobeMarker;
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

const RADIUS = 44;

function project(marker: GlobeMarker, rotationDeg: number): ProjectedMarker {
  const lat = (marker.lat * Math.PI) / 180;
  const lng = ((marker.lng + rotationDeg) * Math.PI) / 180;

  const x = Math.cos(lat) * Math.sin(lng);
  const y = Math.sin(lat);
  const z = Math.cos(lat) * Math.cos(lng);

  return {
    marker,
    x: 50 + x * RADIUS,
    y: 50 - y * RADIUS,
    z,
    visible: z > 0,
  };
}

const Globe3D = ({ markers, className, rotationSpeed = 0.3 }: Globe3DProps) => {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      setRotation((prev) => (prev + rotationSpeed * 0.18) % 360);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [rotationSpeed]);

  const projected = useMemo(
    () => markers.map((marker) => project(marker, rotation)),
    [markers, rotation]
  );

  return (
    <div className={cn("relative aspect-square w-full", className)}>
      <div className="absolute inset-[-6%] rounded-full bg-cyan-400/18 blur-3xl" />
      <div className="relative h-full w-full overflow-hidden rounded-full border border-gold/25 bg-[radial-gradient(circle_at_30%_24%,rgba(110,231,183,0.3),transparent_40%),radial-gradient(circle_at_65%_68%,rgba(45,212,191,0.28),transparent_56%),linear-gradient(150deg,hsl(155_32%_10%),hsl(153_30%_4%))] shadow-[0_24px_70px_rgba(20,184,166,0.24)]">
        <motion.div
          animate={{ rotate: -rotation }}
          className="absolute inset-[-35%]"
          transition={{ duration: 0, ease: "linear" }}
        >
          <div className="absolute inset-[20%] rounded-full border border-gold/20" />
          <div className="absolute inset-[28%] rounded-full border border-gold/15" />
          <div className="absolute inset-[36%] rounded-full border border-gold/10" />

          <div className="absolute top-[50%] left-[14%] h-[1px] w-[72%] bg-gradient-to-r from-transparent via-gold/25 to-transparent" />
          <div className="absolute top-[38%] left-[20%] h-[1px] w-[60%] bg-gradient-to-r from-transparent via-gold/18 to-transparent" />
          <div className="absolute top-[62%] left-[20%] h-[1px] w-[60%] bg-gradient-to-r from-transparent via-gold/18 to-transparent" />

          <div className="absolute top-[15%] left-1/2 h-[70%] w-[1px] -translate-x-1/2 bg-gradient-to-b from-transparent via-gold/22 to-transparent" />
          <div className="absolute top-[20%] left-[38%] h-[60%] w-[1px] bg-gradient-to-b from-transparent via-gold/16 to-transparent" />
          <div className="absolute top-[20%] left-[62%] h-[60%] w-[1px] bg-gradient-to-b from-transparent via-gold/16 to-transparent" />
        </motion.div>

        {projected.map(({ marker, x, y, z, visible }) => {
          if (!visible) {
            return null;
          }

          const scale = 0.72 + z * 0.34;

          return (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2"
              key={marker.label}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity: 0.3 + z * 0.7,
              }}
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-gold/30" />
              <span className="relative block h-3.5 w-3.5 rounded-full border border-gold/55 bg-gold/75 shadow-[0_0_12px_rgba(234,179,8,0.5)]" />
            </div>
          );
        })}

        <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_72%_30%,rgba(255,255,255,0.14),transparent_35%)]" />
      </div>
    </div>
  );
};

export default Globe3D;
