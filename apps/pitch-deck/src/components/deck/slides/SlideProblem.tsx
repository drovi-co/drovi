import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const commitments = [
  "Promises",
  "Advice",
  "Decisions",
  "Obligations",
  "Models",
  "Assumptions",
];

const sources = [
  "Email threads",
  "Slack conversations",
  "Meeting transcripts",
  "CRM notes",
  "Analyst models",
];

const SlideProblem = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
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
        className="text-3xl sm:text-4xl md:text-5xl font-serif text-ivory mb-3 leading-tight"
      >
        Institutions do not run on data.
      </motion.h2>

      <motion.h3
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.35 }}
        className="text-2xl sm:text-3xl font-serif text-gold/90 mb-6"
      >
        They run on commitments.
      </motion.h3>

      <div className="flex flex-wrap gap-2.5 sm:gap-3 mb-8">
        {commitments.map((item, i) => (
          <motion.span
            key={item}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.5 + i * 0.08 }}
            className="border border-gold/25 px-3 py-1.5 text-xs sm:text-sm text-ivory/80"
          >
            {item}
          </motion.span>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.95 }}
        className="text-base sm:text-lg font-sans text-muted-foreground mb-5"
      >
        These live in:
      </motion.p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-8">
        {sources.map((source, i) => (
          <motion.div
            key={source}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 1.05 + i * 0.08 }}
            className="border border-gold/20 px-4 py-3 text-center font-sans text-xs sm:text-sm text-ivory/70"
          >
            {source}
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.6 }}
        className="text-lg sm:text-xl font-serif text-muted-foreground leading-relaxed"
      >
        There is no authoritative record.
        <br />
        <span className="text-gold/85">Institutions operate on fragmented recollection.</span>
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideProblem;
