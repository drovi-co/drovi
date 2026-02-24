import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const withoutLedger = [
  "Agents hallucinate context",
  "Agents violate prior commitments",
  "Agents contradict internal truth",
  "Agents create institutional risk",
];

const withDrovi = [
  '"What was decided?"',
  '"What is still valid?"',
  '"What is binding?"',
  '"Is this contradictory?"',
];

const SlideAgents = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Why This Matters for AI
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="text-lg sm:text-xl font-serif text-ivory mb-8"
      >
        AI Agents will operate inside institutions.
      </motion.p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 mb-8 sm:mb-10">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="border border-gold/15 p-4 sm:p-6"
        >
          <p className="text-[11px] sm:text-xs font-sans uppercase tracking-[0.2em] sm:tracking-[0.3em] text-gold/40 mb-4">
            Without a ledger
          </p>
          <div className="space-y-3">
            {withoutLedger.map((item) => (
              <p key={item} className="font-sans text-ivory/70 text-sm">
                {item}
              </p>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="border border-gold/30 p-4 sm:p-6 bg-gold/5"
        >
          <p className="text-[11px] sm:text-xs font-sans uppercase tracking-[0.2em] sm:tracking-[0.3em] text-gold mb-4">
            With Drovi
          </p>
          <div className="space-y-3 font-serif italic text-ivory/90 text-sm">
            {withDrovi.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.1 }}
        className="text-base sm:text-xl font-serif text-muted-foreground"
      >
        Drovi becomes the <span className="text-gold">control plane</span> beneath agent execution.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideAgents;
