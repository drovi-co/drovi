import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const SlideFuture = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto text-center">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-10 sm:mb-16"
      >
        The Future
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.3 }}
        className="text-lg sm:text-2xl font-sans text-muted-foreground mb-6 sm:mb-8"
      >
        In 5 years, institutions will not ask:
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.8 }}
        className="text-lg sm:text-xl font-serif italic text-ivory/50 mb-8 sm:mb-12"
      >
        "Where was that email?"
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1.3 }}
        className="text-lg sm:text-2xl font-sans text-muted-foreground mb-6 sm:mb-8"
      >
        They will ask:
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.2, delay: 1.8 }}
        className="text-3xl sm:text-4xl md:text-6xl font-serif italic text-gold leading-tight"
      >
        "What does the ledger say?"
      </motion.h2>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.8, delay: 2.5 }}
        className="w-14 sm:w-20 h-[1px] bg-gold/40 mx-auto mt-8 sm:mt-12 mb-6 sm:mb-8"
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 2.8 }}
        className="text-base sm:text-lg font-serif text-muted-foreground"
      >
        The institutional ledger beneath <span className="text-gold">autonomous capital</span>.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideFuture;
