export interface ConnectorCapabilities {
  supports_incremental: boolean;
  supports_full_refresh: boolean;
  supports_webhooks: boolean;
  supports_real_time: boolean;
}

export interface AvailableConnector {
  type: string;
  configured: boolean;
  missing_env: string[];
  capabilities: ConnectorCapabilities;
}

export interface Connection {
  id: string;
  connector_type: string;
  name: string;
  organization_id: string;
  status: string;
  created_at: string;
  last_sync_at: string | null;
  sync_enabled: boolean;
  streams: string[];
}
