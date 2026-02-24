import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const outcomes = [
  "The system of record for decisions",
  "The control plane for agents",
  "The early warning system for exposure",
];

const SlideFuture = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto text-center">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-10 sm:mb-12"
      >
        The Future
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.25 }}
        className="text-lg sm:text-2xl font-sans text-muted-foreground mb-6"
      >
        In five years, institutions will not ask:
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, delay: 0.65 }}
        className="text-lg sm:text-xl font-serif italic text-ivory/50 mb-8"
      >
        "Where was that email?"
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1.05 }}
        className="text-lg sm:text-2xl font-sans text-muted-foreground mb-6"
      >
        They will ask:
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.1, delay: 1.45 }}
        className="text-3xl sm:text-4xl md:text-6xl font-serif italic text-gold leading-tight"
      >
        "What does the ledger say?"
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 2.1 }}
        className="mt-8 text-base sm:text-lg font-sans text-muted-foreground"
      >
        The institutional ledger becomes:
      </motion.p>

      <div className="mt-4 space-y-2">
        {outcomes.map((item, idx) => (
          <motion.p
            key={item}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 2.25 + idx * 0.1 }}
            className="text-sm sm:text-base text-ivory/82"
          >
            {item}
          </motion.p>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 2.7 }}
        className="mt-6 text-base sm:text-lg font-serif text-gold/80"
      >
        Underneath: autonomous capital.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideFuture;
