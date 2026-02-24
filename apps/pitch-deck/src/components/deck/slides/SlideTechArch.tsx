import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const transformed = [
  "Immutable events",
  "Evidence-linked entries",
  "Bi-temporal truth",
  "Contradiction detection",
  "Exposure mapping",
];

const foundations = [
  "Unified Event Model",
  "Content-hash immutability",
  "Bi-temporal tracking",
  "Proof-first extraction",
  "Graph-based relationship modeling",
];

const SlideTechArch = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        What That Means Technically
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-ivory mb-6"
      >
        Drovi transforms fragmented communication into:
      </motion.h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {transformed.map((item, i) => (
          <motion.div
            key={item}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.5 + i * 0.08 }}
            className="border border-gold/22 bg-forest-light/30 px-4 py-3 text-sm text-ivory/90"
          >
            • {item}
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.95 }}
        className="text-base sm:text-lg font-sans text-muted-foreground mb-4"
      >
        Under the surface:
      </motion.p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        {foundations.map((item, i) => (
          <motion.div
            key={item}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 1.05 + i * 0.08 }}
            className="flex items-center gap-3"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
            <span className="font-sans text-sm sm:text-base text-ivory/82">{item}</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.45 }}
        className="text-base sm:text-lg font-serif italic text-gold/80"
      >
        This is deep infrastructure. Not a wrapper.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideTechArch;
