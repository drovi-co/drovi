use crate::{config::ImperiumConfig, error::AppError};
use sqlx::{postgres::PgPoolOptions, PgPool};

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn connect(config: &ImperiumConfig) -> Result<Self, AppError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(&config.database_url)
            .await
            .map_err(|error| {
                AppError::dependency(format!("failed to connect database: {error}"))
            })?;

        Ok(Self { pool })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn ping(&self) -> Result<(), AppError> {
        sqlx::query_scalar::<_, i64>("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| AppError::unavailable(format!("database ping failed: {error}")))
    }

    pub async fn run_migrations(&self) -> Result<(), AppError> {
        sqlx::migrate!("../../migrations")
            .run(&self.pool)
            .await
            .map_err(|error| AppError::internal(format!("database migration failed: {error}")))
    }
}
