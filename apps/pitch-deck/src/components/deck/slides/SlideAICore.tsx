import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const pipeline = ["Classify", "Extract", "Verify", "Calibrate"];
const deployments = ["Fully Cloud", "Hybrid", "On-Premise"];

const SlideAICore = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        AI Infrastructure
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-5xl font-serif text-ivory mb-4"
      >
        AI at the Core
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="text-base sm:text-lg font-serif italic text-gold/70 mb-8 sm:mb-12"
      >
        Deep infrastructure. Not a wrapper.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="mb-8 sm:mb-12"
      >
        <p className="text-[11px] sm:text-xs font-sans uppercase tracking-[0.2em] sm:tracking-[0.3em] text-muted-foreground mb-4">Multi-Stage Pipeline</p>
        <div className="flex items-center gap-2 flex-wrap">
          {pipeline.map((stage, i) => (
            <motion.div
              key={stage}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: 0.8 + i * 0.15 }}
              className="flex items-center gap-2"
            >
              <span className="border border-gold/30 px-3 sm:px-5 py-2 sm:py-2.5 font-sans text-xs sm:text-sm text-ivory tracking-wider uppercase">
                {stage}
              </span>
              {i < pipeline.length - 1 && <span className="hidden sm:inline text-gold/40">→</span>}
            </motion.div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.4 }}
      >
        <p className="text-[11px] sm:text-xs font-sans uppercase tracking-[0.2em] sm:tracking-[0.3em] text-muted-foreground mb-4">Deployment Options</p>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {deployments.map((dep, i) => (
            <motion.span
              key={dep}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 1.6 + i * 0.1 }}
              className="border border-gold/40 bg-gold/5 px-3 sm:px-5 py-2 font-sans text-[11px] sm:text-xs uppercase tracking-wider text-gold"
            >
              {dep}
            </motion.span>
          ))}
        </div>
      </motion.div>
    </div>
  </SlideLayout>
);

export default SlideAICore;
