"use client";

import { motion } from "framer-motion";
import Image from "next/image";

interface HeroProps {
  onRequestAccess?: () => void;
  onWatchDemo?: () => void;
}

export function Hero({ onRequestAccess, onWatchDemo }: HeroProps) {
  return (
    <section className="relative min-h-screen w-full overflow-clip rounded-[20px]">
      <Image
        alt=""
        className="pointer-events-none absolute inset-0 max-w-none rounded-[20px] object-cover object-bottom"
        fill
        priority
        sizes="100vw"
        src="/images/hero-bg.png"
      />

      <div className="absolute top-[-528px] left-[199px]">
        <div className="absolute top-0 left-0 h-[1084px] w-[1084px] rounded-[542px] bg-[rgba(114,59,0,0.72)] blur-[100px]" />
        <div className="absolute top-[209px] left-[181px] h-[680px] w-[680px] rounded-[542px] bg-[rgba(183,99,7,0.72)] blur-[100px]" />
      </div>

      <div className="absolute right-0 left-0 mx-auto flex w-full max-w-[1440px] flex-col items-center gap-10 overflow-clip px-6 pt-28 pb-16 md:gap-[60px] md:p-[80px] md:pt-[148px]">
        <motion.div
          className="flex w-full max-w-[860px] flex-col items-center gap-8 text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="space-y-5">
            <p className="text-amber-300/90 text-xs uppercase tracking-[0.22em] md:text-sm">
              Drovi
            </p>
            <h1 className="font-normal text-[44px] text-white leading-[0.96] tracking-[-2.2px] md:text-[68px] md:tracking-[-3.2px] lg:text-[84px]">
              The Live Institutional Ledger
            </h1>
            <p className="mx-auto max-w-3xl whitespace-pre-line text-[15px] text-white/78 leading-relaxed md:text-[18px]">
              {`Drovi is a live institutional ledger. It watches the world and your organization at the same time, continuously.

When reality shifts, Drovi calculates what it breaks inside your company, updates what is believed to be true, and shows the evidence.

It is not a news feed. It hunts exposure before it turns into loss, liability, or surprise and proposes the next move.

Humans use it to stay ahead. Agents use it to act with context.`}
            </p>
          </div>

          <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <button
              className="group relative flex w-full items-center justify-center rounded-[80px] bg-white px-6 py-4 font-medium text-[16px] text-black leading-[1.3] tracking-[-0.72px] transition-colors hover:bg-gray-50 sm:w-auto sm:px-[30px] sm:py-[20px] sm:text-[18px]"
              onClick={onRequestAccess}
              type="button"
            >
              Request Private Briefing
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0px_4px_8px_0px_rgba(255,255,255,0.6),inset_4px_-14px_8px_0px_rgba(255,255,255,0.2)]" />
            </button>
            <button
              className="flex w-full items-center justify-center rounded-[80px] bg-[rgba(255,255,255,0.1)] px-6 py-4 font-medium text-[16px] text-white leading-[1.3] tracking-[-0.72px] backdrop-blur-[4px] transition-colors hover:bg-[rgba(255,255,255,0.15)] sm:w-auto sm:p-[20px] sm:text-[18px]"
              onClick={onWatchDemo}
              type="button"
            >
              See It in Action
            </button>
          </div>

          <p className="text-[12px] text-white/45 md:text-[13px]">
            Live evidence trails for every high-consequence transition.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
