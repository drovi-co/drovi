import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  MessageSquare,
  FileText,
  Calendar,
  Building,
  Phone,
  Users,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { ConnectorCard } from "./ConnectorCard";
import { ConnectFlow } from "./ConnectFlow";
import { useConnectionStore, useConnections, useAvailableConnectors } from "../../store/connectionStore";
import { useOrgId } from "../../store/authStore";
import type { ConnectorType, Connection } from "../../api/schemas";

const CONNECTOR_ICONS: Record<string, typeof Mail> = {
  gmail: Mail,
  outlook: Mail,
  slack: MessageSquare,
  notion: FileText,
  google_calendar: Calendar,
  hubspot: Building,
  whatsapp: Phone,
  teams: Users,
};

export function ConnectionsGallery() {
  const orgId = useOrgId();
  const connections = useConnections();
  const availableConnectors = useAvailableConnectors();
  const { loadConnections, isLoading, error } = useConnectionStore();

  const [connectFlowOpen, setConnectFlowOpen] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorType | null>(null);

  useEffect(() => {
    if (orgId) {
      loadConnections(orgId);
    }
  }, [orgId, loadConnections]);

  const handleConnectorClick = (connectorType: ConnectorType) => {
    setSelectedConnector(connectorType);
    setConnectFlowOpen(true);
  };

  const handleConnectFlowClose = () => {
    setConnectFlowOpen(false);
    setSelectedConnector(null);
    // Refresh connections after flow closes
    if (orgId) {
      loadConnections(orgId);
    }
  };

  const getConnectionForConnector = (type: ConnectorType): Connection | undefined => {
    return connections.find((c) => c.connector_type === type);
  };

  // Group connectors by status
  const connectedConnectors = availableConnectors.filter(
    (c) => getConnectionForConnector(c.type)?.status === "active"
  );
  const availableToConnect = availableConnectors.filter(
    (c) => c.available && !getConnectionForConnector(c.type)
  );
  const comingSoonConnectors = availableConnectors.filter((c) => c.comingSoon);

  return (
    <div className="connections-gallery">
      <div className="connections-gallery__header">
        <div className="connections-gallery__title-section">
          <h1 className="connections-gallery__title">Connections</h1>
          <p className="connections-gallery__subtitle">
            Connect your data sources to power your memory
          </p>
        </div>
        {isLoading && (
          <div className="connections-gallery__loading">
            <Loader2 size={16} className="connections-gallery__spinner" />
            <span>Refreshing...</span>
          </div>
        )}
      </div>

      {error && (
        <div className="connections-gallery__error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Connected Sources */}
      {connectedConnectors.length > 0 && (
        <section className="connections-gallery__section">
          <div className="connections-gallery__section-header">
            <CheckCircle size={16} className="connections-gallery__section-icon--connected" />
            <h2 className="connections-gallery__section-title">Connected</h2>
            <span className="connections-gallery__section-count">
              {connectedConnectors.length}
            </span>
          </div>
          <div className="connections-gallery__grid">
            <AnimatePresence mode="popLayout">
              {connectedConnectors.map((connector) => {
                const connection = getConnectionForConnector(connector.type);
                return (
                  <motion.div
                    key={connector.type}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ConnectorCard
                      type={connector.type}
                      name={connector.name}
                      description={connector.description}
                      icon={CONNECTOR_ICONS[connector.type] || FileText}
                      connection={connection}
                      onClick={() => handleConnectorClick(connector.type)}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* Available to Connect */}
      {availableToConnect.length > 0 && (
        <section className="connections-gallery__section">
          <div className="connections-gallery__section-header">
            <RefreshCw size={16} />
            <h2 className="connections-gallery__section-title">Available</h2>
            <span className="connections-gallery__section-count">
              {availableToConnect.length}
            </span>
          </div>
          <div className="connections-gallery__grid">
            <AnimatePresence mode="popLayout">
              {availableToConnect.map((connector) => (
                <motion.div
                  key={connector.type}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <ConnectorCard
                    type={connector.type}
                    name={connector.name}
                    description={connector.description}
                    icon={CONNECTOR_ICONS[connector.type] || FileText}
                    onClick={() => handleConnectorClick(connector.type)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* Coming Soon */}
      {comingSoonConnectors.length > 0 && (
        <section className="connections-gallery__section">
          <div className="connections-gallery__section-header">
            <h2 className="connections-gallery__section-title">Coming Soon</h2>
          </div>
          <div className="connections-gallery__grid">
            {comingSoonConnectors.map((connector) => (
              <ConnectorCard
                key={connector.type}
                type={connector.type}
                name={connector.name}
                description={connector.description}
                icon={CONNECTOR_ICONS[connector.type] || FileText}
                comingSoon
              />
            ))}
          </div>
        </section>
      )}

      {/* Connect Flow Modal */}
      <AnimatePresence>
        {connectFlowOpen && selectedConnector && (
          <ConnectFlow
            connectorType={selectedConnector}
            existingConnection={getConnectionForConnector(selectedConnector)}
            onClose={handleConnectFlowClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
