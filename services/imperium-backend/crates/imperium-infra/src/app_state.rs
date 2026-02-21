use crate::{
    config::ImperiumConfig, db::Database, error::AppError, nats::ImperiumNats,
    redis::ImperiumRedis, repository::ImperiumRepository,
};
use std::sync::Arc;

pub type SharedAppState = Arc<AppState>;

#[derive(Clone)]
pub struct AppState {
    pub config: ImperiumConfig,
    pub database: Database,
    pub redis: ImperiumRedis,
    pub nats: ImperiumNats,
    pub repository: ImperiumRepository,
}

impl AppState {
    pub async fn bootstrap() -> Result<SharedAppState, AppError> {
        let _ = dotenvy::dotenv();

        tracing::info!("imperium bootstrap: loading config");
        let config = ImperiumConfig::from_env()?;
        tracing::info!("imperium bootstrap: connecting database");
        let database = Database::connect(&config).await?;
        tracing::info!("imperium bootstrap: running migrations");
        database.run_migrations().await?;
        let repository = ImperiumRepository::new(database.clone());

        tracing::info!("imperium bootstrap: connecting redis");
        let redis = ImperiumRedis::connect(&config).await?;
        tracing::info!("imperium bootstrap: connecting nats");
        let nats = ImperiumNats::connect(&config).await?;

        tracing::info!("imperium bootstrap: completed");
        Ok(Arc::new(Self {
            config,
            database,
            redis,
            nats,
            repository,
        }))
    }

    pub async fn readiness_check(&self) -> Result<(), AppError> {
        self.database.ping().await?;
        self.redis.ping().await?;
        self.nats.ping().await?;
        Ok(())
    }
}
