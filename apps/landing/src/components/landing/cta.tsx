"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Image from "next/image";

import { useSession } from "@/lib/auth-client";
import { getAppUrl } from "@/lib/utils";

interface CTAProps {
  onRequestAccess?: () => void;
}

export function CTA({ onRequestAccess }: CTAProps) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-32">
      {/* Full gradient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent" />
        <div className="absolute top-1/2 left-1/2 h-[800px] w-[1200px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          {/* Headline */}
          <h2 className="mb-6 font-normal text-[32px] text-foreground leading-[1.1] tracking-[-1.5px] md:mb-8 md:text-[48px] md:tracking-[-2.4px] lg:text-[64px]">
            Give your company
            <br />
            <span className="text-foreground/40">the memory it deserves</span>
          </h2>

          {/* Subheadline */}
          <p className="mx-auto mb-8 max-w-xl text-[15px] text-foreground/60 leading-relaxed md:mb-12 md:text-[18px]">
            Connect your tools. Let Drovi remember what was decided, promised,
            and still owes — across internal teams and customer conversations.
          </p>

          {/* CTA Button */}
          {isAuthenticated ? (
            <a
              className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-4 font-medium text-[16px] text-black transition-all hover:bg-white/90 md:gap-3 md:px-10 md:py-5 md:text-[18px]"
              href={getAppUrl("/dashboard")}
            >
              <span>Open Dashboard</span>
              <div className="flex h-4 w-4 items-center justify-center md:h-5 md:w-5">
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
            </a>
          ) : (
            <button
              className="group relative inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-4 font-medium text-[16px] text-black transition-all hover:bg-white/90 md:gap-3 md:px-10 md:py-5 md:text-[18px]"
              onClick={onRequestAccess}
              type="button"
            >
              <span>Request Access</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 md:h-5 md:w-5" />
              {/* Inset shadow overlay */}
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0px_4px_8px_0px_rgba(255,255,255,0.6),inset_4px_-14px_8px_0px_rgba(255,255,255,0.2)]" />
            </button>
          )}

          {/* Trust text */}
          <p className="mt-6 text-[12px] text-foreground/40 md:mt-8 md:text-[14px]">
            No credit card required • Private beta • Cancel anytime
          </p>
        </motion.div>
      </div>
    </section>
  );
}
