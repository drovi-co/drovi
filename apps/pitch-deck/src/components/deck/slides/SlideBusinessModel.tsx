import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const SlideBusinessModel = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Business Model
      </motion.p>

      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-ivory mb-8"
      >
        High-ACV institutional contracts.
      </motion.h2>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.45 }}
        className="border border-gold/20 p-4 sm:p-6 text-center mb-8"
      >
        <p className="text-2xl sm:text-3xl font-serif text-gold">$80K – $150K</p>
        <p className="text-sm font-sans text-muted-foreground mt-1">per firm per year</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mb-8">
        {[
          "Vertical intelligence packs",
          "Agent runtime licensing",
          "On-prem deployments",
          "Usage-based intelligence APIs",
        ].map((item, i) => (
          <motion.div
            key={item}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.65 + i * 0.1 }}
            className="flex items-center gap-3"
          >
            <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
            <span className="font-sans text-sm sm:text-base text-ivory/80">{item}</span>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 1.1 }}
        className="font-serif italic text-lg text-gold/80"
      >
        This is infrastructure pricing.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideBusinessModel;
