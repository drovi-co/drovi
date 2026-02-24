import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const milestones = [
  "Multi-source ingestion live",
  "Production extraction pipeline",
  "Bi-temporal ledger implemented",
  "Kafka + Temporal event fabric operational",
  "Fine-tuned open-source models deployed",
  "Enterprise pilots in legal and accounting",
];

const SlideTraction = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Traction
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-ivory mb-8"
      >
        Infrastructure is running.
      </motion.h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        {milestones.map((m, i) => (
          <motion.div
            key={m}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.45 + i * 0.1 }}
            className="flex items-center gap-3"
          >
            <span className="text-gold text-lg">✓</span>
            <span className="font-sans text-ivory/80 text-sm">{m}</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.25 }}
        className="mt-8 text-base sm:text-lg font-serif italic text-gold/70 text-center"
      >
        This is not slideware.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideTraction;
