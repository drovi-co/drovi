import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const commitments = [
  "Every decision becomes an entry",
  "Every commitment is tracked",
  "Every change is recorded",
  "Every belief has evidence",
];

const SlideDroviLedger = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        The Solution
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-5xl font-serif text-ivory mb-6"
      >
        Drovi is the <em className="text-gold">Institutional Ledger</em>.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.45 }}
        className="text-base sm:text-lg font-serif italic text-muted-foreground mb-8"
      >
        Not storage.
        <br />
        <span className="text-gold/85">Structured institutional memory.</span>
      </motion.p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-8">
        {commitments.map((entry, i) => (
          <motion.div
            key={entry}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.65 + i * 0.1 }}
            className="border border-gold/30 px-4 sm:px-5 py-3 sm:py-4"
          >
            <span className="font-sans text-sm sm:text-base text-ivory/90">{entry}.</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 1.2 }}
        className="text-lg sm:text-xl font-serif text-gold/80"
      >
        Nothing is silently overwritten.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideDroviLedger;
