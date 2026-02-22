use axum::{extract::State, Json};
use imperium_domain::{
    auth::{
        create_passkey_challenge, issue_session, parse_session_id, refresh_session, ttl_to_usize,
        verify_apple_identity_token, AuthDomainError,
    },
    security::new_audit_event,
};
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct IssueSessionRequest {
    pub user_id: String,
    pub device_id: String,
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IssueSessionResponse {
    pub token: String,
    pub session_id: String,
    pub user_id: String,
    pub device_id: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RefreshSessionRequest {
    pub session_token: String,
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RefreshSessionResponse {
    pub token: String,
    pub session_id: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RevokeSessionRequest {
    pub session_token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PasskeyChallengeRequest {
    pub user_id: String,
    pub rp_id: Option<String>,
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PasskeyChallengeResponse {
    pub challenge_id: String,
    pub challenge: String,
    pub rp_id: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AppleVerifyRequest {
    pub identity_token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AppleVerifyResponse {
    pub subject: String,
    pub email: Option<String>,
    pub issued_at: String,
    pub expires_at: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/auth/session/token",
    tag = "imperium",
    request_body = IssueSessionRequest,
    responses(
        (status = 200, description = "Session issued", body = IssueSessionResponse),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn issue_session_token(
    State(state): State<SharedAppState>,
    Json(payload): Json<IssueSessionRequest>,
) -> Result<Json<IssueSessionResponse>, AppError> {
    let user_id = parse_uuid(&payload.user_id, "user_id")?;

    let session =
        issue_session(user_id, payload.device_id, payload.ttl_seconds).map_err(map_auth_error)?;

    persist_session(&state, &session.token, &session.claims, payload.ttl_seconds).await?;

    emit_audit(
        &state,
        Some(user_id),
        "session.issued",
        format!("session:{}", session.claims.session_id),
        serde_json::json!({"device_id": session.claims.device_id}),
    )
    .await;

    Ok(Json(IssueSessionResponse {
        token: session.token,
        session_id: session.claims.session_id.to_string(),
        user_id: session.claims.user_id.to_string(),
        device_id: session.claims.device_id,
        expires_at: session.claims.expires_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/auth/session/refresh",
    tag = "imperium",
    request_body = RefreshSessionRequest,
    responses(
        (status = 200, description = "Session refreshed", body = RefreshSessionResponse),
        (status = 401, description = "Session not found"),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn refresh_session_token(
    State(state): State<SharedAppState>,
    Json(payload): Json<RefreshSessionRequest>,
) -> Result<Json<RefreshSessionResponse>, AppError> {
    let session_id = parse_session_id(&payload.session_token).map_err(map_auth_error)?;
    let key = session_cache_key(session_id);

    let Some(cached) = state.redis.get_json(&key).await? else {
        return Err(AppError::unauthorized("session not found"));
    };

    let old_claims = serde_json::from_str::<imperium_domain::auth::SessionClaims>(&cached)
        .map_err(|error| AppError::internal(format!("failed to decode cached session: {error}")))?;

    let refreshed = refresh_session(&old_claims, payload.ttl_seconds).map_err(map_auth_error)?;

    persist_session(
        &state,
        &refreshed.token,
        &refreshed.claims,
        payload.ttl_seconds,
    )
    .await?;

    state.redis.delete(&key).await?;

    emit_audit(
        &state,
        Some(old_claims.user_id),
        "session.refreshed",
        format!("session:{}", refreshed.claims.session_id),
        serde_json::json!({"prior_session_id": old_claims.session_id}),
    )
    .await;

    Ok(Json(RefreshSessionResponse {
        token: refreshed.token,
        session_id: refreshed.claims.session_id.to_string(),
        expires_at: refreshed.claims.expires_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/auth/session/revoke",
    tag = "imperium",
    request_body = RevokeSessionRequest,
    responses(
        (status = 200, description = "Session revoked"),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn revoke_session_token(
    State(state): State<SharedAppState>,
    Json(payload): Json<RevokeSessionRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let session_id = parse_session_id(&payload.session_token).map_err(map_auth_error)?;
    let key = session_cache_key(session_id);

    state.redis.delete(&key).await?;

    emit_audit(
        &state,
        None,
        "session.revoked",
        format!("session:{session_id}"),
        serde_json::json!({}),
    )
    .await;

    Ok(Json(
        serde_json::json!({"revoked": true, "session_id": session_id}),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/auth/passkeys/challenge",
    tag = "imperium",
    request_body = PasskeyChallengeRequest,
    responses(
        (status = 200, description = "Passkey challenge generated", body = PasskeyChallengeResponse),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn passkey_challenge(
    State(state): State<SharedAppState>,
    Json(payload): Json<PasskeyChallengeRequest>,
) -> Result<Json<PasskeyChallengeResponse>, AppError> {
    let user_id = parse_uuid(&payload.user_id, "user_id")?;
    let rp_id = payload
        .rp_id
        .unwrap_or_else(|| "imperium.local".to_string());

    let challenge =
        create_passkey_challenge(user_id, rp_id, payload.ttl_seconds).map_err(map_auth_error)?;

    let ttl_seconds = payload.ttl_seconds.unwrap_or(300);
    let ttl = ttl_to_usize(ttl_seconds).map_err(map_auth_error)?;

    let key = format!("passkey_challenge:{}", challenge.challenge_id);
    let serialized = serde_json::to_string(&challenge)
        .map_err(|error| AppError::internal(format!("failed to encode challenge: {error}")))?;
    state.redis.set_json(&key, &serialized, ttl).await?;

    emit_audit(
        &state,
        Some(user_id),
        "passkey.challenge.created",
        format!("passkey_challenge:{}", challenge.challenge_id),
        serde_json::json!({"rp_id": challenge.rp_id}),
    )
    .await;

    Ok(Json(PasskeyChallengeResponse {
        challenge_id: challenge.challenge_id.to_string(),
        challenge: challenge.challenge,
        rp_id: challenge.rp_id,
        expires_at: challenge.expires_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/auth/apple/verify",
    tag = "imperium",
    request_body = AppleVerifyRequest,
    responses(
        (status = 200, description = "Apple identity token accepted", body = AppleVerifyResponse),
        (status = 400, description = "Invalid identity token")
    )
)]
pub async fn verify_apple_identity(
    State(state): State<SharedAppState>,
    Json(payload): Json<AppleVerifyRequest>,
) -> Result<Json<AppleVerifyResponse>, AppError> {
    let expected_audience = state
        .config
        .apple_client_id
        .as_deref()
        .ok_or_else(|| AppError::configuration("missing IMPERIUM_APPLE_CLIENT_ID"))?;

    let assertion = verify_apple_identity_token(&payload.identity_token, expected_audience)
        .await
        .map_err(map_auth_error)?;

    emit_audit(
        &state,
        None,
        "apple.identity.verified",
        format!("apple_subject:{}", assertion.subject),
        serde_json::json!({}),
    )
    .await;

    Ok(Json(AppleVerifyResponse {
        subject: assertion.subject,
        email: assertion.email,
        issued_at: assertion.issued_at.to_rfc3339(),
        expires_at: assertion.expires_at.to_rfc3339(),
    }))
}

fn parse_uuid(raw: &str, field_name: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(raw)
        .map_err(|_| AppError::validation(format!("invalid {field_name}: must be uuid")))
}

fn map_auth_error(error: AuthDomainError) -> AppError {
    match error {
        AuthDomainError::InvalidIdentityToken
        | AuthDomainError::InvalidSessionToken
        | AuthDomainError::InvalidTtl => AppError::validation(error.to_string()),
        AuthDomainError::AppleIdentityAudienceNotConfigured => {
            AppError::configuration(error.to_string())
        }
        AuthDomainError::AppleIdentityProviderUnavailable => {
            AppError::dependency(error.to_string())
        }
    }
}

async fn persist_session(
    state: &SharedAppState,
    token: &str,
    claims: &imperium_domain::auth::SessionClaims,
    ttl_seconds: Option<i64>,
) -> Result<(), AppError> {
    let key = session_cache_key(claims.session_id);
    let serialized = serde_json::to_string(claims)
        .map_err(|error| AppError::internal(format!("failed to encode session claims: {error}")))?;

    let computed_ttl_seconds =
        ttl_seconds.unwrap_or_else(|| (claims.expires_at - claims.issued_at).num_seconds());
    let ttl = ttl_to_usize(computed_ttl_seconds).map_err(map_auth_error)?;

    state.redis.set_json(&key, &serialized, ttl).await?;

    let token_index_key = format!("session_token:{}", claims.session_id);
    state.redis.set_json(&token_index_key, token, ttl).await?;

    Ok(())
}

fn session_cache_key(session_id: Uuid) -> String {
    format!("session:{session_id}")
}

async fn emit_audit(
    state: &SharedAppState,
    actor_user_id: Option<Uuid>,
    action: impl Into<String>,
    target: impl Into<String>,
    metadata: serde_json::Value,
) {
    let event = new_audit_event(actor_user_id, action, target, metadata);
    if let Err(error) = state
        .repository
        .append_audit_event("imperium.auth.audit", &event)
        .await
    {
        tracing::warn!("failed to persist auth audit event: {error}");
    }

    if let Err(error) = state.nats.publish_json("imperium.auth.audit", &event).await {
        tracing::warn!("failed to publish auth audit event: {error}");
    }
}
