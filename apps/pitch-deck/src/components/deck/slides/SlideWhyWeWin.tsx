import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const advantages = [
  "We treat memory as infrastructure.",
  "We enforce proof before persistence.",
  "We built bi-temporal institutional reality.",
  "We integrate across systems rather than replace them.",
  "We support on-prem for private capital and regulated firms.",
];

const SlideWhyWeWin = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Why We Win
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="text-base sm:text-lg text-muted-foreground mb-2"
      >
        Most AI tools accelerate output.
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.35 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-gold mb-8"
      >
        We institutionalize truth.
      </motion.h2>

      <div className="space-y-4 sm:space-y-5 mb-8">
        {advantages.map((adv, i) => (
          <motion.div
            key={adv}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.5 + i * 0.1 }}
            className="flex items-baseline gap-4"
          >
            <span className="text-2xl font-serif font-bold text-gold/70">{i + 1}</span>
            <span className="text-sm sm:text-base md:text-lg font-sans text-ivory/85">{adv}</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 1.1 }}
        className="font-serif italic text-lg text-gold/85"
      >
        Ledger first. Agents second.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideWhyWeWin;
