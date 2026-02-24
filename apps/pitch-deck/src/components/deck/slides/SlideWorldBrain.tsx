import { motion } from "framer-motion";

import Globe3D from "../visuals/Globe3D";
import SlideLayout from "../SlideLayout";

const watched = [
  "Markets",
  "Regulation",
  "Court rulings",
  "Research",
  "News",
  "Macro shifts",
];

const computed = [
  "What does this break internally?",
  "Which commitments are exposed?",
  "Which assumptions degrade?",
];

const SlideWorldBrain = () => {
  return (
    <SlideLayout>
      <motion.div
        className="mx-auto w-full max-w-6xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7 }}
      >
        <motion.p className="mb-6 text-gold/60 text-xs uppercase tracking-[0.24em] sm:text-sm">
          From Ledger to World Brain
        </motion.p>

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <motion.p
              className="text-base sm:text-lg text-muted-foreground leading-relaxed"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
            >
              The ledger records internal truth.
              <br />
              World Brain extends that ledger to reality itself.
            </motion.p>

            <motion.p
              className="mt-6 text-sm uppercase tracking-[0.18em] text-gold/70"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              Drovi watches:
            </motion.p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {watched.map((item, idx) => (
                <motion.div
                  key={item}
                  className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-ivory/86"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.42 + idx * 0.06 }}
                >
                  {item}
                </motion.div>
              ))}
            </div>

            <motion.p
              className="mt-6 text-sm uppercase tracking-[0.18em] text-gold/70"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.7 }}
            >
              When reality shifts, Drovi computes:
            </motion.p>

            <div className="mt-3 space-y-2.5">
              {computed.map((item, idx) => (
                <motion.p
                  key={item}
                  className="text-sm sm:text-base text-ivory/84"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, delay: 0.8 + idx * 0.08 }}
                >
                  {item}
                </motion.p>
              ))}
            </div>

            <motion.p
              className="mt-6 font-serif italic text-gold/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.1 }}
            >
              This is not a news feed.
              <br />
              It is an early warning system.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
          >
            <Globe3D />
          </motion.div>
        </div>
      </motion.div>
    </SlideLayout>
  );
};

export default SlideWorldBrain;
