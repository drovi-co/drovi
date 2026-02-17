import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const entries = ["Decisions", "Commitments", "Risks", "Tasks", "Advice", "Contradictions"];
const traits = ["Linked to source evidence", "Time-aware", "Versioned", "Auditable", "Non-destructive"];

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
        className="text-2xl sm:text-3xl md:text-5xl font-serif text-ivory mb-8 sm:mb-12"
      >
        Drovi = The <em className="text-gold">Institutional Ledger</em>
      </motion.h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-8 sm:mb-10">
        {entries.map((entry, i) => (
          <motion.div
            key={entry}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
            className="border border-gold/30 px-4 sm:px-5 py-3 sm:py-4 text-center"
          >
            <span className="font-serif text-base sm:text-lg text-ivory">{entry}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, delay: 1.2 }}
        className="w-14 sm:w-16 h-[1px] bg-gold/40 mb-6 sm:mb-8"
      />

      <div className="flex flex-wrap gap-2 sm:gap-3">
        {traits.map((trait, i) => (
          <motion.span
            key={trait}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 1.4 + i * 0.1 }}
            className="border border-gold/20 px-3 sm:px-4 py-1.5 text-[11px] sm:text-xs font-sans uppercase tracking-wider text-gold/70"
          >
            {trait}
          </motion.span>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 2 }}
        className="mt-8 sm:mt-10 text-base sm:text-lg font-serif italic text-muted-foreground"
      >
        Not storage. <span className="text-gold">Structured institutional memory.</span>
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideDroviLedger;
