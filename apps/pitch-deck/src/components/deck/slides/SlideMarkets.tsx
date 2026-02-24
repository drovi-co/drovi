import { motion } from "framer-motion";
import SlideLayout from "../SlideLayout";

const markets = [
  { name: "Legal Firms", note: "Advice is obligation." },
  { name: "Accounting Firms", note: "Precision is mandate." },
  { name: "Family Offices", note: "Discretion is currency." },
  { name: "Hedge Funds", note: "Context is alpha." },
  { name: "Private Equity", note: "Commitments are capital." },
  { name: "Real Estate", note: "Records are proof." },
];

const SlideMarkets = () => (
  <SlideLayout>
    <div className="w-full max-w-5xl mx-auto">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-xs sm:text-sm font-sans uppercase tracking-[0.22em] sm:tracking-[0.3em] text-gold/60 mb-6 sm:mb-8"
      >
        Initial Markets
      </motion.p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {markets.map((m, i) => (
          <motion.div
            key={m.name}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}
            className="border border-gold/25 p-4 sm:p-5 text-center"
          >
            <p className="font-serif text-ivory text-base sm:text-lg mb-1">{m.name}</p>
            <p className="font-sans text-[11px] sm:text-xs text-gold/60 uppercase tracking-wider">{m.note}</p>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.9 }}
        className="mt-8 text-base sm:text-lg font-serif text-muted-foreground leading-relaxed"
      >
        <p>Words become obligations.</p>
        <p>Forgetting becomes liability.</p>
        <p className="text-gold">Proof becomes currency.</p>
      </motion.div>
    </div>
  </SlideLayout>
);

export default SlideMarkets;
