import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const risks = [
  "Decisions are reinterpreted.",
  "Commitments are forgotten.",
  "Advice contradicts itself.",
  "Agents act on outdated context.",
  "Risk accumulates silently.",
  "Liability increases.",
];

const SlideWhatBreaks = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        What Breaks
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-ivory mb-8 sm:mb-12"
      >
        When there is no authoritative record:
      </motion.h2>

      <div className="space-y-3 sm:space-y-4 mb-8 sm:mb-12">
        {risks.map((risk, i) => (
          <motion.div
            key={risk}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.5 + i * 0.15 }}
            className="flex items-start sm:items-center gap-3 sm:gap-4"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
            <span className="text-base sm:text-lg md:text-xl font-serif text-ivory/90">{risk}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.6 }}
        className="border-t border-gold/20 pt-8 space-y-2"
      >
        <p className="text-base sm:text-lg font-sans text-muted-foreground">AI without a ledger is <span className="text-gold">dangerous</span>.</p>
        <p className="text-base sm:text-lg font-sans text-muted-foreground">Humans without a ledger are <span className="text-gold">inconsistent</span>.</p>
      </motion.div>
    </div>
  </SlideLayout>
);

export default SlideWhatBreaks;
