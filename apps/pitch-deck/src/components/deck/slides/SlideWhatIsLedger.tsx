import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const properties = [
  "Entries are explicit.",
  "Every entry has provenance.",
  "Changes are recorded over time.",
  "Nothing is silently overwritten.",
  "It can be audited.",
];

const SlideWhatIsLedger = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Definition
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-5xl font-serif text-ivory mb-4"
      >
        What Is a Ledger?
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="text-base sm:text-lg font-serif italic text-gold/70 mb-8 sm:mb-12"
      >
        The authoritative, permanent record of economic reality.
      </motion.p>

      <div className="space-y-4 sm:space-y-5 mb-8 sm:mb-12">
        {properties.map((prop, i) => (
          <motion.div
            key={prop}
            initial={{ opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.6 + i * 0.2 }}
            className="flex items-baseline gap-4 sm:gap-5"
          >
            <span className="text-2xl sm:text-3xl font-serif font-bold text-gold">{i + 1}</span>
            <span className="text-base sm:text-lg md:text-xl font-sans text-ivory/85">{prop}</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.8 }}
        className="text-base sm:text-lg md:text-xl font-serif text-muted-foreground leading-relaxed"
      >
        Accounting has ledgers. Capital has ledgers. Ownership has ledgers.
        <br />
        <span className="text-gold">Institutional decisions do not.</span>
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideWhatIsLedger;
