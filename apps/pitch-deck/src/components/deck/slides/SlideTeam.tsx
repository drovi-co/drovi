import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const SlideTeam = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto text-center">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-8 sm:mb-12"
      >
        The Team
      </motion.p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25 }}
          className="text-left rounded-2xl border border-gold/20 p-5"
        >
          <h3 className="text-xl sm:text-2xl font-serif text-ivory mb-1">Jeremy Scatigna</h3>
          <p className="text-xs sm:text-sm font-sans uppercase tracking-[0.14em] sm:tracking-[0.2em] text-gold mb-4">
            Founder & CEO
          </p>
          <p className="font-sans text-sm text-muted-foreground">
            Infrastructure and AI engineer. Built distributed systems at scale.
            Focused on long-term institutional architecture.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          className="text-left rounded-2xl border border-gold/20 p-5"
        >
          <h3 className="text-xl sm:text-2xl font-serif text-ivory mb-1">Tristan Frullani</h3>
          <p className="text-xs sm:text-sm font-sans uppercase tracking-[0.14em] sm:tracking-[0.2em] text-gold mb-4">
            Founder & COO
          </p>
          <p className="font-sans text-sm text-muted-foreground">
            Operator. Built and scaled operationally heavy businesses.
            Execution discipline. Financial rigor. Operational control.
          </p>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.9 }}
        className="mt-8 font-serif italic text-base sm:text-lg text-muted-foreground"
      >
        Disciplined. Structured. Long-term.
      </motion.p>
    </div>
  </SlideLayout>
);

export default SlideTeam;
