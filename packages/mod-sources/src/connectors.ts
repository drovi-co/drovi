export interface ConnectorDefinition {
  id: string;
  displayName: string;
  enabled: boolean;
}

export function filterAllowedConnectors(
  connectors: ConnectorDefinition[],
  allowedConnectorIds: string[] | null
): ConnectorDefinition[] {
  if (!allowedConnectorIds || allowedConnectorIds.length === 0) {
    return connectors;
  }

  const allowed = new Set(allowedConnectorIds);
  return connectors.filter((connector) => allowed.has(connector.id));
}

export function connectorHealthTone(
  status: string
): "good" | "warning" | "critical" {
  if (status === "connected" || status === "healthy") {
    return "good";
  }
  if (status === "error" || status === "failed") {
    return "critical";
  }
  return "warning";
}
