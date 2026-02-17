import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const sources = ["Email threads", "Slack conversations", "Meeting transcripts", "PDFs", "CRM notes", "Analyst models"];

const SlideProblem = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        The Problem
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-3xl sm:text-4xl md:text-5xl font-serif text-ivory mb-8 sm:mb-10 md:mb-12 leading-tight"
      >
        Institutions operate on <em className="text-gold">promises</em>.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="text-base sm:text-lg font-sans text-muted-foreground mb-6 sm:mb-8"
      >
        But these promises are not recorded in one place. They live in:
      </motion.p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-8 sm:mb-12">
        {sources.map((source, i) => (
          <motion.div
            key={source}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.7 + i * 0.1 }}
            className="border border-gold/20 px-4 py-3 text-center font-sans text-xs sm:text-sm text-ivory/70"
          >
            {source}
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.5 }}
        className="text-xl sm:text-2xl font-serif italic text-gold/80"
      >
        Institutions run on fragmented recollection.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideProblem;
