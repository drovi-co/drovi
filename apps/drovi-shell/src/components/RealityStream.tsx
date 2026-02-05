import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Clock, Eye, ChevronRight, X } from "lucide-react";
import { useUIStore } from "../store/uiStore";

export interface EvidenceItem {
  id?: string;
  source?: string;
  snippet?: string;
  timestamp?: string;
}

export interface TimelineItem {
  time?: string;
  label?: string;
  detail?: string;
  evidence?: EvidenceItem[];
}

interface RealityStreamProps {
  title?: string;
  timeline: TimelineItem[];
  evidence: EvidenceItem[];
}

const TYPE_COLORS: Record<string, string> = {
  Decision: "var(--color-decision)",
  Commitment: "var(--color-commitment)",
  Risk: "var(--color-risk)",
  Task: "var(--color-task)",
  Event: "var(--color-text-secondary)",
};

export function RealityStream({ title, timeline, evidence }: RealityStreamProps) {
  const { openEvidenceLens } = useUIStore();
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const fallbackEvidence = useMemo(() => evidence ?? [], [evidence]);

  const handleViewEvidence = (item: TimelineItem) => {
    const evidenceItems = item.evidence?.length ? item.evidence : fallbackEvidence;
    // Use the first evidence ID if available, or create a synthetic one
    const firstEvidence = evidenceItems[0];
    if (firstEvidence?.id) {
      openEvidenceLens(firstEvidence.id);
    }
  };

  return (
    <div className="reality-stream">
      <div className="reality-stream__header">
        <h2>{title ?? "Reality Stream"}</h2>
        <span className="reality-stream__count">{timeline.length} events</span>
      </div>

      <div className="reality-stream__timeline">
        {timeline.length === 0 ? (
          <div className="reality-stream__empty">
            <Calendar size={32} style={{ opacity: 0.3 }} />
            <p>No events in the timeline</p>
          </div>
        ) : (
          timeline.map((item, index) => {
            const color = TYPE_COLORS[item.label ?? "Event"] || TYPE_COLORS.Event;
            const isExpanded = expandedItem === index;

            return (
              <motion.div
                key={`${item.time ?? index}`}
                className="timeline-item"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                {/* Timeline Connector */}
                <div className="timeline-item__connector">
                  <div
                    className="timeline-item__dot"
                    style={{ backgroundColor: color }}
                  />
                  {index < timeline.length - 1 && (
                    <div className="timeline-item__line" />
                  )}
                </div>

                {/* Content */}
                <div className="timeline-item__content">
                  <div className="timeline-item__header">
                    <span className="timeline-item__time">
                      <Clock size={12} />
                      {item.time ?? "—"}
                    </span>
                    <span
                      className="timeline-item__type"
                      style={{ color, backgroundColor: `${color}15` }}
                    >
                      {item.label ?? "Event"}
                    </span>
                  </div>

                  <p className="timeline-item__detail">{item.detail ?? ""}</p>

                  {/* Evidence Preview */}
                  {(item.evidence?.length ?? 0) > 0 && (
                    <div className="timeline-item__evidence">
                      <button
                        className="timeline-item__evidence-toggle"
                        onClick={() => setExpandedItem(isExpanded ? null : index)}
                      >
                        <Eye size={14} />
                        <span>{item.evidence?.length} evidence</span>
                        <ChevronRight
                          size={14}
                          style={{
                            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                            transition: "transform 0.2s",
                          }}
                        />
                      </button>

                      <AnimatePresence>
                        {isExpanded && item.evidence && (
                          <motion.div
                            className="timeline-item__evidence-list"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            {item.evidence.map((ev, evIndex) => (
                              <div
                                key={ev.id ?? evIndex}
                                className="timeline-item__evidence-snippet"
                              >
                                <span className="evidence-source">
                                  {ev.source ?? "Source"}
                                </span>
                                <span className="evidence-text">
                                  {ev.snippet ?? "No snippet"}
                                </span>
                                {ev.timestamp && (
                                  <span className="evidence-time">{ev.timestamp}</span>
                                )}
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
