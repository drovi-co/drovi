import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const layers = [
  {
    num: "I",
    title: "Unified Event Model",
    desc: "Every email, message, meeting, document becomes an immutable event with content hash, provenance, and timestamp.",
  },
  {
    num: "II",
    title: "Bi-Temporal Truth Engine",
    desc: "Valid-time and system-time tracking. Know what was true in reality and when it entered the system.",
  },
  {
    num: "III",
    title: "Evidence-First Extraction",
    desc: "No Evidence → No Persist. Every decision references specific quoted spans with confidence reasoning.",
  },
  {
    num: "IV",
    title: "Contradiction & Supersession",
    desc: "Detects contradictions across time, links superseded commitments, maintains decision trails.",
  },
];

const SlideTechArch = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Architecture
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-ivory mb-8 sm:mb-12"
      >
        Four Layers of <em className="text-gold">Ledger-Grade</em> Truth
      </motion.h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {layers.map((layer, i) => (
          <motion.div
            key={layer.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 + i * 0.2 }}
            className="border border-gold/25 p-4 sm:p-6 bg-forest-light/30"
          >
            <span className="text-gold/50 font-serif text-sm">{layer.num}</span>
            <h3 className="font-serif text-lg sm:text-xl text-ivory mt-1 mb-3">{layer.title}</h3>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed">{layer.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </SlideLayout>
);

export default SlideTechArch;
