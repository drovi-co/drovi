import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ExternalLink,
  Copy,
  Check,
  Mail,
  MessageSquare,
  FileText,
  Calendar,
  Phone,
  Video,
  Mic,
  Globe,
  Edit3,
  Clock,
  BookOpen,
} from "lucide-react";
import { useUIStore } from "../../store/uiStore";

// Source type icons
const SOURCE_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  slack: MessageSquare,
  notion: FileText,
  google_docs: FileText,
  whatsapp: MessageSquare,
  calendar: Calendar,
  meeting: Video,
  call: Phone,
  recording: Mic,
  transcript: FileText,
  api: Globe,
  manual: Edit3,
};

// Source type colors
const SOURCE_COLORS: Record<string, string> = {
  email: "var(--color-commitment)",
  slack: "#4A154B",
  notion: "var(--color-text-primary)",
  google_docs: "#4285F4",
  whatsapp: "#25D366",
  calendar: "var(--color-contact)",
  meeting: "var(--color-decision)",
  call: "var(--color-task)",
  recording: "var(--color-risk)",
  transcript: "var(--color-text-secondary)",
  api: "var(--color-accent)",
  manual: "var(--color-text-muted)",
};

interface EvidenceData {
  id: string;
  source_type: string;
  snippet?: string;
  full_content?: string;
  metadata?: {
    sender?: string;
    recipients?: string[];
    subject?: string;
    timestamp?: string;
    channel?: string;
    thread_id?: string;
    url?: string;
    [key: string]: unknown;
  };
}

export function EvidenceLens() {
  const evidenceLensOpen = useUIStore((s) => s.evidenceLensOpen);
  const evidenceLensId = useUIStore((s) => s.evidenceLensId);
  const { closeEvidenceLens } = useUIStore();

  const [evidence, setEvidence] = useState<EvidenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch evidence data
  useEffect(() => {
    if (!evidenceLensOpen || !evidenceLensId) {
      setEvidence(null);
      return;
    }

    setLoading(true);

    // Mock evidence data - in production this would fetch from API
    const mockEvidence: EvidenceData = {
      id: evidenceLensId,
      source_type: "email",
      snippet: "We committed to deliver the Q4 product launch by December 15th. This is a firm deadline.",
      full_content: `Hi Team,

Following up on our meeting yesterday, I wanted to confirm our commitments for Q4:

1. Product Launch - We committed to deliver the Q4 product launch by December 15th. This is a firm deadline.
2. Partnership Agreement - Legal review to be completed by November 30th
3. Budget Approval - Pending final sign-off from CFO

Please let me know if you have any questions or concerns about these timelines.

Best regards,
Sarah`,
      metadata: {
        sender: "sarah.johnson@company.com",
        recipients: ["team@company.com", "stakeholders@company.com"],
        subject: "Re: Q4 Commitments and Timelines",
        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
        thread_id: "thread_abc123",
      },
    };

    // Simulate API delay
    setTimeout(() => {
      setEvidence(mockEvidence);
      setLoading(false);
    }, 300);
  }, [evidenceLensOpen, evidenceLensId]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!evidenceLensOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeEvidenceLens();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [evidenceLensOpen, closeEvidenceLens]);

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeEvidenceLens();
      }
    },
    [closeEvidenceLens]
  );

  // Copy to clipboard
  const handleCopy = async () => {
    if (!evidence?.full_content && !evidence?.snippet) return;

    try {
      await navigator.clipboard.writeText(evidence.full_content || evidence.snippet || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!evidenceLensOpen) return null;

  const Icon = evidence ? SOURCE_ICONS[evidence.source_type] || BookOpen : BookOpen;
  const color = evidence ? SOURCE_COLORS[evidence.source_type] || "var(--color-text-secondary)" : "var(--color-text-secondary)";

  return (
    <AnimatePresence>
      {evidenceLensOpen && (
        <>
          {/* Overlay */}
          <motion.div
            className="evidence-lens__overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleOverlayClick}
          />

          {/* Modal */}
          <motion.div
            className="evidence-lens"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {/* Header */}
            <div className="evidence-lens__header">
              <div className="evidence-lens__source-badge" style={{ backgroundColor: `${color}15`, color }}>
                <Icon size={16} />
                <span>{formatSourceType(evidence?.source_type || "unknown")}</span>
              </div>
              <div className="evidence-lens__actions">
                <button
                  className="btn btn--ghost btn--icon"
                  onClick={handleCopy}
                  aria-label="Copy content"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
                {evidence?.metadata?.url && (
                  <a
                    href={evidence.metadata.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--ghost btn--icon"
                    aria-label="Open source"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
                <button
                  className="btn btn--ghost btn--icon"
                  onClick={closeEvidenceLens}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Content */}
            {loading ? (
              <div className="evidence-lens__loading">
                <div className="evidence-lens__spinner" />
                <span>Loading evidence...</span>
              </div>
            ) : evidence ? (
              <div className="evidence-lens__content">
                {/* Metadata */}
                {evidence.metadata && (
                  <div className="evidence-lens__metadata">
                    {evidence.metadata.subject && (
                      <h3 className="evidence-lens__subject">{evidence.metadata.subject}</h3>
                    )}
                    <div className="evidence-lens__meta-row">
                      {evidence.metadata.sender && (
                        <span className="evidence-lens__sender">
                          From: <strong>{evidence.metadata.sender}</strong>
                        </span>
                      )}
                      {evidence.metadata.timestamp && (
                        <span className="evidence-lens__timestamp">
                          <Clock size={12} />
                          {formatTimestamp(evidence.metadata.timestamp)}
                        </span>
                      )}
                    </div>
                    {evidence.metadata.recipients && evidence.metadata.recipients.length > 0 && (
                      <span className="evidence-lens__recipients">
                        To: {evidence.metadata.recipients.join(", ")}
                      </span>
                    )}
                    {evidence.metadata.channel && (
                      <span className="evidence-lens__channel">
                        Channel: #{evidence.metadata.channel}
                      </span>
                    )}
                  </div>
                )}

                {/* Full Content or Snippet */}
                <div className="evidence-lens__text">
                  {evidence.full_content || evidence.snippet}
                </div>

                {/* Highlighted Snippet */}
                {evidence.snippet && evidence.full_content && evidence.snippet !== evidence.full_content && (
                  <div className="evidence-lens__highlight">
                    <span className="evidence-lens__highlight-label">Extracted:</span>
                    <p>{evidence.snippet}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="evidence-lens__empty">
                <BookOpen size={32} style={{ opacity: 0.3 }} />
                <p>Evidence not found</p>
              </div>
            )}

            {/* Footer */}
            <div className="evidence-lens__footer">
              <span className="evidence-lens__id">ID: {evidenceLensId}</span>
              <button className="btn btn--secondary btn--sm" onClick={closeEvidenceLens}>
                Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Utility functions
function formatSourceType(sourceType: string): string {
  const labels: Record<string, string> = {
    email: "Email",
    slack: "Slack",
    notion: "Notion",
    google_docs: "Google Docs",
    whatsapp: "WhatsApp",
    calendar: "Calendar",
    meeting: "Meeting",
    call: "Call",
    recording: "Recording",
    transcript: "Transcript",
    api: "API",
    manual: "Manual Entry",
  };
  return labels[sourceType] || sourceType;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default EvidenceLens;
