import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const advantages = [
  "We treat memory as infrastructure.",
  "We enforce proof before persistence.",
  "We built bi-temporal institutional truth.",
  "We integrate across systems, not replace them.",
  "We support on-premise deployment for private capital.",
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
        Competitive Advantage
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-5xl font-serif text-ivory mb-8 sm:mb-12"
      >
        Why We Win
      </motion.h2>

      <div className="space-y-4 sm:space-y-6 mb-8 sm:mb-12">
        {advantages.map((adv, i) => (
          <motion.div
            key={adv}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.5 + i * 0.2 }}
            className="flex items-baseline gap-4 sm:gap-6"
          >
            <span className="text-3xl sm:text-4xl font-serif font-bold text-gold/70">{i + 1}</span>
            <span className="text-base sm:text-lg md:text-xl font-sans text-ivory/85">{adv}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.6 }}
        className="border-t border-gold/20 pt-6"
      >
        <p className="font-serif italic text-base sm:text-lg text-muted-foreground">
          Most AI tools accelerate output. <span className="text-gold">We institutionalize truth.</span>
        </p>
      </motion.div>
    </div>
  </SlideLayout>
);

export default SlideWhyWeWin;
