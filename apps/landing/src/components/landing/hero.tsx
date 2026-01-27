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
      {/* Background Image */}
      <Image
        alt=""
        className="pointer-events-none absolute inset-0 max-w-none rounded-[20px] object-cover object-bottom"
        fill
        priority
        sizes="100vw"
        src="/images/hero-bg.png"
      />

      {/* Gradient Overlays - pixel perfect from Figma */}
      <div className="absolute top-[-528px] left-[199px]">
        <div className="absolute top-0 left-0 h-[1084px] w-[1084px] rounded-[542px] bg-[rgba(114,59,0,0.72)] blur-[100px]" />
        <div className="absolute top-[209px] left-[181px] h-[680px] w-[680px] rounded-[542px] bg-[rgba(183,99,7,0.72)] blur-[100px]" />
      </div>

      {/* Content Container - pixel perfect from Figma */}
      <div className="absolute right-0 left-0 mx-auto flex w-full max-w-[1440px] flex-col items-center gap-10 overflow-clip px-6 pt-28 pb-16 md:gap-[60px] md:p-[80px] md:pt-[148px]">
        {/* Text and CTAs Container */}
        <div className="flex w-full max-w-[758px] flex-col items-center gap-[32px]">
          {/* Headline and Subheadline */}
          <div className="flex w-full flex-col items-center gap-[20px] text-center">
            {/* Headline */}
            <h1 className="w-full font-normal text-[44px] text-white leading-none tracking-[-2.5px] md:text-[60px] md:tracking-[-3.5px] lg:text-[80px] lg:tracking-[-4.8px]">
              <span className="block">The memory</span>
              <span className="block">infrastructure for work</span>
            </h1>

            {/* Subheadline */}
            <p className="max-w-[574px] font-normal text-[16px] text-[rgba(255,255,255,0.8)] leading-[1.5] tracking-[-0.5px] md:text-[18px] md:tracking-[-0.72px]">
              A shared, queryable intelligence layer that humans, agents, and
              systems rely on to know what's true. What was decided. What was
              promised. What's still owed.
            </p>
          </div>

          {/* CTAs */}
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-[8px]"
            initial={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            {/* See It in Action Button */}
            <button
              className="flex w-full items-center justify-center rounded-[80px] bg-[rgba(255,255,255,0.1)] px-6 py-4 font-medium text-[16px] text-white leading-[1.3] tracking-[-0.72px] backdrop-blur-[4px] transition-colors hover:bg-[rgba(255,255,255,0.15)] sm:w-auto sm:p-[20px] sm:text-[18px]"
              onClick={onWatchDemo}
              type="button"
            >
              See It in Action
            </button>

            {/* Request Access Button */}
            <button
              className="group relative flex w-full items-center justify-center gap-[10px] rounded-[80px] bg-white px-6 py-4 font-medium text-[16px] text-black leading-[1.3] tracking-[-0.72px] transition-colors hover:bg-gray-50 sm:w-auto sm:px-[30px] sm:py-[20px] sm:text-[18px]"
              onClick={onRequestAccess}
              type="button"
            >
              <span>Request Access</span>
              <div className="flex h-[20px] w-[20px] items-center justify-center">
                <div className="rotate-[-45deg]">
                  <Image
                    alt=""
                    className="block"
                    height={13}
                    src="/images/arrow-icon.svg"
                    width={15}
                  />
                </div>
              </div>
              {/* Inset shadow overlay */}
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0px_4px_8px_0px_rgba(255,255,255,0.6),inset_4px_-14px_8px_0px_rgba(255,255,255,0.2)]" />
            </button>
          </motion.div>
        </div>

        {/* Trusted By Section */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center gap-4 md:gap-[20px]"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <p className="font-normal text-[14px] text-[rgba(255,255,255,0.5)] leading-[1.3] tracking-[-0.5px] md:text-[17px] md:tracking-[-0.68px]">
            Trusted by best
          </p>
          {/* Company Logos */}
          <div className="flex flex-wrap items-center justify-center gap-6 md:flex-nowrap md:gap-[43px]">
            <Image
              alt="Alexun"
              className="h-[18px] w-auto md:h-[22px]"
              height={22}
              src="/images/logo-alexun.svg"
              width={114}
            />
            <Image
              alt="Journey"
              className="h-[24px] w-auto md:h-[29px]"
              height={29}
              src="/images/logo-journey.svg"
              width={120}
            />
            <Image
              alt="GrowthView"
              className="h-[20px] w-auto md:h-[24px]"
              height={24}
              src="/images/logo-growthview.svg"
              width={131}
            />
            <Image
              alt="AIVA"
              className="h-[22px] w-auto md:h-[26px]"
              height={26}
              src="/images/logo-aiva.svg"
              width={88}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
