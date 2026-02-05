import { User, Star, Mail, Building, MessageSquare, Calendar } from "lucide-react";
import { motion } from "framer-motion";
import type { ContactSummary, ContactDetail } from "../../api/schemas";

interface ContactResultProps {
  contact: ContactSummary | ContactDetail;
  onClick?: () => void;
}

function isContactDetail(
  contact: ContactSummary | ContactDetail
): contact is ContactDetail {
  return "created_at" in contact;
}

export function ContactResult({ contact, onClick }: ContactResultProps) {
  const healthScore = contact.health_score ?? 0.5;
  const healthColor =
    healthScore >= 0.7
      ? "var(--color-confidence-high)"
      : healthScore >= 0.4
      ? "var(--color-confidence-medium)"
      : "var(--color-confidence-low)";

  const healthLabel =
    healthScore >= 0.7
      ? "Healthy"
      : healthScore >= 0.4
      ? "Needs Attention"
      : "At Risk";

  return (
    <motion.div
      className="contact-result"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <div className="contact-result__header">
        <div className="contact-result__avatar">
          <User size={20} />
        </div>
        <div className="contact-result__info">
          <div className="contact-result__name-row">
            <h3 className="contact-result__name">{contact.display_name}</h3>
            {contact.is_vip && (
              <span className="contact-result__vip">
                <Star size={12} />
                <span>VIP</span>
              </span>
            )}
          </div>
          {contact.company && (
            <p className="contact-result__company">
              <Building size={12} />
              <span>{contact.company}</span>
            </p>
          )}
          <p className="contact-result__email">
            <Mail size={12} />
            <span>{contact.primary_email}</span>
          </p>
        </div>
        <div className="contact-result__health">
          <div
            className="contact-result__health-score"
            style={{ color: healthColor }}
          >
            {Math.round(healthScore * 100)}%
          </div>
          <span
            className="contact-result__health-label"
            style={{ color: healthColor }}
          >
            {healthLabel}
          </span>
        </div>
      </div>

      {(contact.total_threads !== undefined || contact.total_messages !== undefined) && (
        <div className="contact-result__stats">
          {contact.total_threads !== undefined && (
            <div className="contact-result__stat">
              <Mail size={14} />
              <span className="contact-result__stat-value">{contact.total_threads}</span>
              <span className="contact-result__stat-label">Threads</span>
            </div>
          )}
          {contact.total_messages !== undefined && (
            <div className="contact-result__stat">
              <MessageSquare size={14} />
              <span className="contact-result__stat-value">{contact.total_messages}</span>
              <span className="contact-result__stat-label">Messages</span>
            </div>
          )}
        </div>
      )}

      {contact.title && (
        <div className="contact-result__topics">
          <span className="contact-result__topic">{contact.title}</span>
        </div>
      )}

      {contact.is_at_risk && (
        <div className="contact-result__commitments">
          <span className="contact-result__commitment-badge contact-result__commitment-badge--risk">
            At Risk
          </span>
        </div>
      )}
    </motion.div>
  );
}
