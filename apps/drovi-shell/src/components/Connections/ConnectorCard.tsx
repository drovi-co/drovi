import { motion } from "framer-motion";
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Clock,
  ChevronRight,
} from "lucide-react";
import type { Connection, ConnectorType } from "../../api/schemas";
import { formatDistanceToNow, parseISO } from "date-fns";

interface ConnectorCardProps {
  type: ConnectorType;
  name: string;
  description: string;
  icon: typeof CheckCircle;
  connection?: Connection;
  comingSoon?: boolean;
  onClick?: () => void;
}

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  active: CheckCircle,
  pending: Clock,
  error: AlertCircle,
  syncing: Loader2,
};

const STATUS_COLORS: Record<string, string> = {
  active: "var(--color-success)",
  pending: "var(--color-warning)",
  error: "var(--color-error)",
  syncing: "var(--color-accent)",
};

export function ConnectorCard({
  type,
  name,
  description,
  icon: Icon,
  connection,
  comingSoon,
  onClick,
}: ConnectorCardProps) {
  const isConnected = connection?.status === "active";
  const status = connection?.status;
  const StatusIcon = status ? STATUS_ICONS[status] : null;

  const lastSynced = connection?.last_sync_at
    ? formatDistanceToNow(parseISO(connection.last_sync_at), { addSuffix: true })
    : null;

  return (
    <motion.button
      className={`connector-card ${isConnected ? "connector-card--connected" : ""} ${
        comingSoon ? "connector-card--coming-soon" : ""
      }`}
      onClick={comingSoon ? undefined : onClick}
      whileHover={comingSoon ? {} : { scale: 1.02 }}
      whileTap={comingSoon ? {} : { scale: 0.98 }}
      disabled={comingSoon}
    >
      <div className="connector-card__icon-wrapper">
        <Icon size={24} />
      </div>

      <div className="connector-card__content">
        <div className="connector-card__header">
          <h3 className="connector-card__name">{name}</h3>
          {comingSoon && (
            <span className="connector-card__badge connector-card__badge--soon">
              Coming Soon
            </span>
          )}
          {status && StatusIcon && (
            <span
              className={`connector-card__status connector-card__status--${status}`}
              style={{ color: STATUS_COLORS[status] }}
            >
              <StatusIcon
                size={14}
                className={status === "syncing" ? "connector-card__spinner" : ""}
              />
            </span>
          )}
        </div>
        <p className="connector-card__description">{description}</p>
        {isConnected && lastSynced && (
          <p className="connector-card__sync-info">
            <Clock size={12} />
            <span>Last synced {lastSynced}</span>
          </p>
        )}
      </div>

      {!comingSoon && (
        <div className="connector-card__arrow">
          <ChevronRight size={16} />
        </div>
      )}
    </motion.button>
  );
}
