import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const uses = [
  "Harden the ledger core",
  "Scale world-brain ingest and causality infrastructure",
  "Expand vertical intelligence packs",
  "Ship AgentOS control plane",
  "Close first 5 institutional deployments",
];

const SlideRaise = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto text-center">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        The Raise
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-4xl sm:text-5xl md:text-7xl font-serif text-gold mb-8"
      >
        $1.5M
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.45 }}
        className="text-base sm:text-lg font-sans text-muted-foreground mb-6"
      >
        To:
      </motion.p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 text-left w-full max-w-2xl mx-auto mb-10">
        {uses.map((use, i) => (
          <motion.div
            key={use}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.6 + i * 0.08 }}
            className="flex items-center gap-3"
          >
            <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
            <span className="font-sans text-sm text-ivory/80">{use}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.2 }}
        className="border-t border-gold/20 pt-8 space-y-2"
      >
        <p className="font-sans text-sm text-muted-foreground">Capital has ledgers.</p>
        <p className="font-sans text-sm text-muted-foreground">Ownership has ledgers.</p>
        <p className="font-sans text-sm text-muted-foreground">Risk has ledgers.</p>
        <p className="font-serif italic text-lg sm:text-xl text-gold">Drovi is the ledger of truth.</p>
      </motion.div>
    </div>
  </SlideLayout>
);

export default SlideRaise;
