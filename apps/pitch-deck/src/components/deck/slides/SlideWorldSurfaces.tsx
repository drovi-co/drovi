import { motion } from "framer-motion";

import SlideLayout from "../SlideLayout";

const surfaces = [
  {
    title: "Ledger",
    body: "Belief trails with full provenance",
  },
  {
    title: "Tape",
    body: "Only consequential state changes",
  },
  {
    title: "Counterfactual Lab",
    body: "Intervention A/B/C before execution",
  },
  {
    title: "Obligation Sentinel",
    body: "Pre-breach detection",
  },
  {
    title: "Ask v2",
    body: "Truth first • Uncertainty second • Recommendation third",
  },
];

const SlideWorldSurfaces = () => (
  <SlideLayout>
    <motion.div
      className="mx-auto w-full max-w-6xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.7 }}
    >
      <motion.p className="mb-6 text-gold/60 text-xs uppercase tracking-[0.24em] sm:text-sm">
        Product Surfaces
      </motion.p>

      <motion.h2 className="max-w-4xl text-3xl text-ivory leading-tight sm:text-4xl md:text-5xl">
        The operating surfaces of institutional truth.
      </motion.h2>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {surfaces.map((surface, idx) => (
          <motion.article
            key={surface.title}
            className="rounded-2xl border border-gold/20 bg-forest-light/40 p-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: idx * 0.07 }}
          >
            <h3 className="text-ivory text-lg">{surface.title}</h3>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{surface.body}</p>
          </motion.article>
        ))}
      </div>
    </motion.div>
  </SlideLayout>
);

export default SlideWorldSurfaces;
