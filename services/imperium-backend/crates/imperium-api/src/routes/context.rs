use axum::{
    extract::{FromRef, FromRequestParts},
    http::{header::AUTHORIZATION, request::Parts},
};
use chrono::Utc;
use imperium_domain::auth::{parse_session_id, SessionClaims};
use imperium_infra::{error::AppError, SharedAppState};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct AuthContext {
    pub user_id: Uuid,
}

impl<S> FromRequestParts<S> for AuthContext
where
    S: Send + Sync,
    SharedAppState: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = SharedAppState::from_ref(state);

        if let Some(token) = extract_bearer_token(parts) {
            let session_id = parse_session_id(token)
                .map_err(|_| AppError::unauthorized("invalid session token"))?;
            let session_key = format!("session:{session_id}");

            let Some(cached_claims) = app_state.redis.get_json(&session_key).await? else {
                return Err(AppError::unauthorized("session not found"));
            };

            let claims =
                serde_json::from_str::<SessionClaims>(&cached_claims).map_err(|error| {
                    AppError::internal(format!("failed to decode session claims: {error}"))
                })?;

            if claims.expires_at < Utc::now() {
                return Err(AppError::unauthorized("session expired"));
            }

            let token_key = format!("session_token:{session_id}");
            let cached_token = app_state.redis.get_json(&token_key).await?;
            if cached_token.as_deref() != Some(token) {
                return Err(AppError::unauthorized("session token mismatch"));
            }

            return Ok(Self {
                user_id: claims.user_id,
            });
        }

        if allow_development_fallback(&app_state.config.environment) {
            return Ok(Self {
                user_id: Uuid::from_u128(1),
            });
        }

        Err(AppError::unauthorized(
            "missing Authorization header with Bearer session token",
        ))
    }
}

fn extract_bearer_token(parts: &Parts) -> Option<&str> {
    let raw = parts.headers.get(AUTHORIZATION)?.to_str().ok()?;
    raw.strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

fn allow_development_fallback(environment: &str) -> bool {
    matches!(
        environment.to_ascii_lowercase().as_str(),
        "development" | "dev" | "local" | "test"
    )
}
