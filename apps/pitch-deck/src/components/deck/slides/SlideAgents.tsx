import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const SlideAgents = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Agent Control Plane
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-ivory mb-8 sm:mb-12"
      >
        Why This Matters for <em className="text-gold">AI Agents</em>
      </motion.h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 mb-8 sm:mb-12">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="border border-gold/15 p-4 sm:p-6"
        >
          <p className="text-[11px] sm:text-xs font-sans uppercase tracking-[0.2em] sm:tracking-[0.3em] text-gold/40 mb-4">Without a Ledger</p>
          <div className="space-y-3">
            {["Agents hallucinate context.", "Agents violate prior commitments.", "Agents create institutional risk."].map((item, i) => (
              <p key={i} className="font-sans text-ivory/60 text-sm">{item}</p>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="border border-gold/30 p-4 sm:p-6 bg-gold/5"
        >
          <p className="text-[11px] sm:text-xs font-sans uppercase tracking-[0.2em] sm:tracking-[0.3em] text-gold mb-4">With Drovi</p>
          <div className="space-y-3 font-serif italic text-ivory/90 text-sm">
            <p>"What was decided?"</p>
            <p>"What is still valid?"</p>
            <p>"What is the latest binding commitment?"</p>
            <p>"Is this contradictory?"</p>
          </div>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.2 }}
        className="text-base sm:text-xl font-serif text-muted-foreground text-center"
      >
        Drovi becomes the <span className="text-gold">control plane</span> beneath agent execution.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideAgents;
