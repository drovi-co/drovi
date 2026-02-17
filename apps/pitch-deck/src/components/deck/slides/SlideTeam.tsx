import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const SlideTeam = () => (
  <SlideLayout>
    <div className="w-full max-w-4xl mx-auto text-center">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-8 sm:mb-12"
      >
        The Team
      </motion.p>

      <div className="flex flex-col md:flex-row items-center justify-center gap-10 sm:gap-12 md:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="text-center"
        >
          <h3 className="text-xl sm:text-2xl font-serif text-ivory mb-1">Jeremy Scatigna</h3>
          <p className="text-xs sm:text-sm font-sans uppercase tracking-[0.14em] sm:tracking-[0.2em] text-gold mb-4">Founder & CEO</p>
          <p className="font-sans text-sm text-muted-foreground max-w-xs">
            Infrastructure and AI engineer. Built distributed systems at scale.
          </p>
        </motion.div>

        <motion.div
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="hidden md:block w-[1px] h-24 bg-gold/30"
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="text-center"
        >
          <h3 className="text-xl sm:text-2xl font-serif text-ivory mb-1">Tristan Frullani</h3>
          <p className="text-xs sm:text-sm font-sans uppercase tracking-[0.14em] sm:tracking-[0.2em] text-gold mb-4">Co-Founder</p>
          <p className="font-sans text-sm text-muted-foreground max-w-xs">
            Operator. Built and scaled operationally heavy businesses.
          </p>
        </motion.div>
      </div>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, delay: 0.9 }}
        className="w-14 sm:w-16 h-[1px] bg-gold/30 mx-auto mt-8 sm:mt-12 mb-5 sm:mb-6"
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.1 }}
        className="font-serif italic text-base sm:text-lg text-muted-foreground"
      >
        Disciplined. Structured. Long-term.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideTeam;
