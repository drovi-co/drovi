use crate::{config::ImperiumConfig, error::AppError};
use redis::{aio::ConnectionManager, AsyncCommands};
use tokio::time::{timeout, Duration};

#[derive(Clone)]
pub struct ImperiumRedis {
    manager: ConnectionManager,
    namespace: String,
}

impl ImperiumRedis {
    pub async fn connect(config: &ImperiumConfig) -> Result<Self, AppError> {
        let client = redis::Client::open(config.redis_url.as_str()).map_err(|error| {
            AppError::dependency(format!("failed to create redis client: {error}"))
        })?;
        let manager = timeout(Duration::from_secs(30), ConnectionManager::new(client))
            .await
            .map_err(|_| {
                AppError::dependency("timed out connecting redis after 30s".to_string())
            })?
            .map_err(|error| AppError::dependency(format!("failed to connect redis: {error}")))?;

        Ok(Self {
            manager,
            namespace: config.redis_namespace.clone(),
        })
    }

    pub fn key(&self, key: &str) -> String {
        format!("{}:{key}", self.namespace)
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        let mut manager = self.manager.clone();
        let pong: String = redis::cmd("PING")
            .query_async(&mut manager)
            .await
            .map_err(|error| AppError::unavailable(format!("redis ping failed: {error}")))?;

        if pong == "PONG" {
            Ok(())
        } else {
            Err(AppError::unavailable(format!(
                "unexpected redis ping response: {pong}"
            )))
        }
    }

    pub async fn set_json(
        &self,
        key: &str,
        value: &str,
        ttl_seconds: usize,
    ) -> Result<(), AppError> {
        let mut manager = self.manager.clone();
        let namespaced_key = self.key(key);

        let _: () = manager
            .set_ex(namespaced_key, value, ttl_seconds as u64)
            .await
            .map_err(|error| AppError::dependency(format!("redis set failed: {error}")))?;

        Ok(())
    }

    pub async fn get_json(&self, key: &str) -> Result<Option<String>, AppError> {
        let mut manager = self.manager.clone();
        let namespaced_key = self.key(key);

        manager
            .get::<String, Option<String>>(namespaced_key)
            .await
            .map_err(|error| AppError::dependency(format!("redis get failed: {error}")))
    }

    pub async fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut manager = self.manager.clone();
        let namespaced_key = self.key(key);

        let _: usize = manager
            .del(namespaced_key)
            .await
            .map_err(|error| AppError::dependency(format!("redis delete failed: {error}")))?;

        Ok(())
    }
}
