import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const SlideTitle = () => (
  <SlideLayout mobileAlign="center">
    <div className="w-full px-2 text-center flex flex-col items-center gap-6 sm:gap-8">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.2 }}
      >
        <h1 className="text-5xl sm:text-7xl md:text-9xl font-serif font-bold tracking-[0.16em] sm:tracking-[0.22em] md:tracking-[0.3em] text-ivory">
          DROVI
        </h1>
      </motion.div>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.8, delay: 0.8 }}
        className="w-16 sm:w-24 h-[1px] bg-gold"
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 1.2 }}
        className="max-w-[24rem] text-xs sm:text-sm md:text-xl font-sans tracking-[0.12em] sm:tracking-[0.18em] md:tracking-[0.25em] uppercase leading-relaxed text-gold/80"
      >
        The Institutional Ledger for Modern Firms
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideTitle;
