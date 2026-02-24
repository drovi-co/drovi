import { motion, useReducedMotion } from "framer-motion";

import SlideLayout from "../SlideLayout";
import WorldMap from "../visuals/WorldMap";

const outcomes = [
  {
    metric: "10x",
    label: "Target reduction in unseen high-severity external impact events",
  },
  {
    metric: "5x",
    label: "Faster root-cause reconstruction during executive incidents",
  },
  {
    metric: ">90%",
    label: "Evidence coverage goal on high-stakes belief transitions",
  },
];

const entranceEase = [0.22, 1, 0.36, 1] as const;

const stageVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      duration: 0.66,
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

const SlideWorldTwin = () => {
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
          Institutional World Twin
        </motion.p>

        <motion.h2
          className="max-w-4xl text-3xl text-ivory leading-tight sm:text-4xl md:text-5xl"
          variants={itemVariants}
        >
          World pressure map: external change to internal consequence.
        </motion.h2>

        <motion.div
          className="mt-8"
          animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : {
                  duration: 6.4,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }
          }
          variants={itemVariants}
        >
          <WorldMap />
        </motion.div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {outcomes.map((item, idx) => (
            <motion.article
              key={item.label}
              className="rounded-2xl border border-gold/20 bg-gold/6 p-4"
              variants={itemVariants}
              transition={{ duration: 0.45, delay: idx * 0.06, ease: entranceEase }}
              whileHover={{ y: -4, scale: 1.01 }}
            >
              <p className="text-2xl text-gold sm:text-3xl">{item.metric}</p>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                {item.label}
              </p>
            </motion.article>
          ))}
        </div>
      </motion.div>
    </SlideLayout>
  );
};

export default SlideWorldTwin;
