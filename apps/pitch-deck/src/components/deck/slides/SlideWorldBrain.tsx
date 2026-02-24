import { motion, useReducedMotion } from "framer-motion";

import Globe3D from "../visuals/Globe3D";
import SlideLayout from "../SlideLayout";

const highlights = [
  "Evidence-backed beliefs",
  "Causal pressure mapping",
  "Governed interventions",
  "Temporal accountability",
];

const entranceEase = [0.22, 1, 0.36, 1] as const;

const stageVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      duration: 0.65,
      ease: entranceEase,
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.58, ease: entranceEase },
  },
};

const SlideWorldBrain = () => {
  const reduceMotion = useReducedMotion();

  return (
    <SlideLayout>
      <motion.div
        className="mx-auto w-full max-w-6xl"
        initial="hidden"
        animate="show"
        variants={stageVariants}
      >
        <motion.p
          className="mb-6 text-gold/60 text-xs uppercase tracking-[0.24em] sm:text-sm"
          variants={itemVariants}
        >
          World Brain Expansion
        </motion.p>

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div variants={itemVariants}>
            <motion.h2
              className="text-3xl text-ivory leading-tight sm:text-4xl md:text-5xl"
              variants={itemVariants}
            >
              From memory infrastructure to
              <em className="text-gold"> institutional cognition</em>.
            </motion.h2>

            <motion.p
              className="mt-5 max-w-2xl text-base text-muted-foreground leading-relaxed sm:text-lg"
              variants={itemVariants}
            >
              World Brain continuously fuses global and internal signals into a
              live belief system that can explain impact paths and recommend
              governed action.
            </motion.p>

            <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
              {highlights.map((item, idx) => (
                <motion.div
                  key={item}
                  className="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2 text-sm text-ivory/86"
                  variants={itemVariants}
                  transition={{ duration: 0.45, delay: idx * 0.06, ease: entranceEase }}
                  whileHover={{ y: -2, scale: 1.01 }}
                >
                  {item}
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: 5,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }
            }
            variants={itemVariants}
          >
            <Globe3D />
          </motion.div>
        </div>
      </motion.div>
    </SlideLayout>
  );
};

export default SlideWorldBrain;
