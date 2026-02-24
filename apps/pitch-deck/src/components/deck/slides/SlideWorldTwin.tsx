import { motion } from "framer-motion";

import SlideLayout from "../SlideLayout";
import WorldMap from "../visuals/WorldMap";

const twinState = [
  "Internal state",
  "External signals",
  "Exposure topology",
  "Obligations",
  "Strategic objectives",
];

const SlideWorldTwin = () => {
  return (
    <SlideLayout>
      <motion.div
        className="mx-auto w-full max-w-6xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7 }}
      >
        <motion.p className="mb-6 text-gold/60 text-xs uppercase tracking-[0.24em] sm:text-sm">
          Institutional World Twin
        </motion.p>

        <motion.h2 className="max-w-4xl text-3xl text-ivory leading-tight sm:text-4xl md:text-5xl">
          Each organization gets a live twin.
        </motion.h2>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {twinState.map((item, idx) => (
            <motion.div
              key={item}
              className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-ivory/86"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2 + idx * 0.06 }}
            >
              {item}
            </motion.div>
          ))}
        </div>

        <motion.div className="mt-7" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.45 }}>
          <WorldMap />
        </motion.div>

        <motion.p
          className="mt-6 text-base sm:text-lg font-serif text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.8 }}
        >
          When something changes externally:
          <br />
          The twin recalculates impact.
          <br />
          <span className="text-gold">Before you react, Drovi already has.</span>
        </motion.p>
      </motion.div>
    </SlideLayout>
  );
};

export default SlideWorldTwin;
