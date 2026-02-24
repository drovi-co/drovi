import { motion } from "framer-motion";

import SlideLayout from "../SlideLayout";

const surfaces = [
  {
    title: "Ledger",
    body: "Belief trails, evidence bundles, and contradiction timelines.",
  },
  {
    title: "Tape",
    body: "State deltas only: no noise, only consequential transitions.",
  },
  {
    title: "Counterfactual Lab",
    body: "Intervention A/B/C utility comparisons before execution.",
  },
  {
    title: "Obligation Sentinel",
    body: "Pre-breach detection across law, policy, and contracts.",
  },
  {
    title: "Ask v2",
    body: "Truth payload first, uncertainty second, recommendation third.",
  },
];

const moat = [
  "Event-native architecture across ingest -> belief -> intervention topics",
  "Multi-memory design for causal, normative, procedural, and strategic recall",
  "Policy gating and rollback requirements for all side-effecting actions",
];

const entranceEase = [0.22, 1, 0.36, 1] as const;

const stageVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      duration: 0.64,
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

const SlideWorldSurfaces = () => (
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
        Productized World Brain
      </motion.p>

      <motion.h2
        className="max-w-4xl text-3xl text-ivory leading-tight sm:text-4xl md:text-5xl"
        variants={itemVariants}
      >
        The control-room surfaces + infrastructure moat.
      </motion.h2>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {surfaces.map((surface, idx) => (
          <motion.article
            key={surface.title}
            className="rounded-2xl border border-gold/20 bg-forest-light/40 p-4"
            variants={itemVariants}
            transition={{ duration: 0.45, delay: idx * 0.06, ease: entranceEase }}
            whileHover={{ y: -4 }}
          >
            <h3 className="text-ivory text-lg">{surface.title}</h3>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
              {surface.body}
            </p>
          </motion.article>
        ))}
      </div>

      <motion.div
        className="mt-6 rounded-2xl border border-gold/22 bg-gold/7 p-5"
        variants={itemVariants}
      >
        <p className="mb-3 text-gold/75 text-xs uppercase tracking-[0.2em]">
          Defensibility
        </p>
        <div className="space-y-2.5">
          {moat.map((item, idx) => (
            <motion.p
              className="text-ivory/82 text-sm leading-relaxed"
              key={item}
              variants={itemVariants}
              transition={{ duration: 0.45, delay: idx * 0.06, ease: entranceEase }}
            >
              {item}
            </motion.p>
          ))}
        </div>
      </motion.div>
    </motion.div>
  </SlideLayout>
);

export default SlideWorldSurfaces;
