use crate::{config::ImperiumConfig, error::AppError, telemetry::record_nats_publish};
use tokio::time::{timeout, Duration};

#[derive(Clone)]
pub struct ImperiumNats {
    client: async_nats::Client,
}

impl ImperiumNats {
    pub async fn connect(config: &ImperiumConfig) -> Result<Self, AppError> {
        let client = timeout(Duration::from_secs(30), async_nats::connect(config.nats_url.clone()))
            .await
            .map_err(|_| AppError::dependency("timed out connecting nats after 30s".to_string()))?
            .map_err(|error| AppError::dependency(format!("failed to connect nats: {error}")))?;

        Ok(Self { client })
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        self.client
            .flush()
            .await
            .map_err(|error| AppError::unavailable(format!("nats flush failed: {error}")))
    }

    pub async fn publish_json<T>(&self, subject: &str, payload: &T) -> Result<(), AppError>
    where
        T: serde::Serialize,
    {
        let bytes = serde_json::to_vec(payload).map_err(|error| {
            AppError::internal(format!("failed to serialize nats payload: {error}"))
        })?;

        self.client
            .publish(subject.to_string(), bytes.into())
            .await
            .map_err(|error| {
                record_nats_publish(subject, "error");
                AppError::dependency(format!("nats publish failed: {error}"))
            })?;

        record_nats_publish(subject, "ok");

        Ok(())
    }

    pub async fn subscribe(&self, subject: &str) -> Result<async_nats::Subscriber, AppError> {
        self.client
            .subscribe(subject.to_string())
            .await
            .map_err(|error| AppError::dependency(format!("nats subscribe failed: {error}")))
    }
}
