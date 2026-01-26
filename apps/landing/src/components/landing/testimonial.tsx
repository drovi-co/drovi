"use client";

import { motion } from "framer-motion";
import { Quote } from "lucide-react";

export function Testimonial() {
  return (
    <section className="relative overflow-hidden px-6 py-20 md:py-32">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1, y: 0 }}
        >
          {/* Quote icon */}
          <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 md:mb-10 md:h-16 md:w-16 md:rounded-2xl">
            <Quote className="h-6 w-6 text-amber-500 md:h-8 md:w-8" />
          </div>

          {/* Quote */}
          <blockquote className="mb-8 md:mb-10">
            <p className="font-normal text-[24px] text-foreground leading-[1.3] tracking-[-1px] md:text-[36px] md:tracking-[-1.5px] lg:text-[44px]">
              "Finally — a system that remembers what we decided, promised, and
              still owe.{" "}
              <span className="text-amber-500">
                Internally and with customers.
              </span>
              "
            </p>
          </blockquote>

          {/* Attribution */}
          <div className="flex flex-col items-center gap-3 md:gap-4">
            {/* Avatar dots representing multiple users */}
            <div className="flex -space-x-2">
              {[...new Array(5)].map((_, i) => (
                <div
                  className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 ring-2 ring-background md:h-10 md:w-10"
                  key={i}
                  style={{
                    opacity: 1 - i * 0.15,
                  }}
                />
              ))}
            </div>
            <p className="text-[13px] text-foreground/40 md:text-[15px]">
              Private Beta Users
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
