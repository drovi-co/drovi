use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AuthDomainError {
    #[error("invalid identity token format")]
    InvalidIdentityToken,
    #[error("invalid session token format")]
    InvalidSessionToken,
    #[error("invalid ttl seconds")]
    InvalidTtl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionClaims {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub device_id: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionToken {
    pub token: String,
    pub claims: SessionClaims,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasskeyChallenge {
    pub challenge_id: Uuid,
    pub user_id: Uuid,
    pub challenge: String,
    pub rp_id: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleIdentityAssertion {
    pub subject: String,
    pub email: Option<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

const DEFAULT_SESSION_TTL_SECONDS: i64 = 60 * 60 * 24;
const MAX_SESSION_TTL_SECONDS: i64 = 60 * 60 * 24 * 30;

pub fn issue_session(
    user_id: Uuid,
    device_id: String,
    ttl_seconds: Option<i64>,
) -> Result<SessionToken, AuthDomainError> {
    let ttl = validate_ttl(ttl_seconds)?;

    let session_id = Uuid::new_v4();
    let secret = Uuid::new_v4();
    let issued_at = Utc::now();

    let claims = SessionClaims {
        session_id,
        user_id,
        device_id,
        issued_at,
        expires_at: issued_at + Duration::seconds(ttl),
    };

    Ok(SessionToken {
        token: format!("{session_id}.{secret}"),
        claims,
    })
}

pub fn refresh_session(
    old: &SessionClaims,
    ttl_seconds: Option<i64>,
) -> Result<SessionToken, AuthDomainError> {
    issue_session(old.user_id, old.device_id.clone(), ttl_seconds)
}

pub fn parse_session_id(token: &str) -> Result<Uuid, AuthDomainError> {
    let Some((session_id_raw, _)) = token.split_once('.') else {
        return Err(AuthDomainError::InvalidSessionToken);
    };

    Uuid::parse_str(session_id_raw).map_err(|_| AuthDomainError::InvalidSessionToken)
}

pub fn create_passkey_challenge(
    user_id: Uuid,
    rp_id: String,
    ttl_seconds: Option<i64>,
) -> Result<PasskeyChallenge, AuthDomainError> {
    let ttl = validate_ttl(ttl_seconds)?;
    let challenge_id = Uuid::new_v4();

    Ok(PasskeyChallenge {
        challenge_id,
        user_id,
        challenge: Uuid::new_v4().to_string(),
        rp_id,
        expires_at: Utc::now() + Duration::seconds(ttl),
    })
}

pub fn verify_apple_identity_token(
    identity_token: &str,
) -> Result<AppleIdentityAssertion, AuthDomainError> {
    let parts = identity_token.split('.').count();
    if parts != 3 {
        return Err(AuthDomainError::InvalidIdentityToken);
    }

    let now = Utc::now();
    Ok(AppleIdentityAssertion {
        subject: "apple-subject-placeholder".to_string(),
        email: None,
        issued_at: now,
        expires_at: now + Duration::hours(1),
    })
}

pub fn ttl_to_usize(ttl_seconds: i64) -> Result<usize, AuthDomainError> {
    if ttl_seconds <= 0 {
        return Err(AuthDomainError::InvalidTtl);
    }

    usize::try_from(ttl_seconds).map_err(|_| AuthDomainError::InvalidTtl)
}

fn validate_ttl(ttl_seconds: Option<i64>) -> Result<i64, AuthDomainError> {
    let ttl = ttl_seconds.unwrap_or(DEFAULT_SESSION_TTL_SECONDS);

    if ttl <= 0 || ttl > MAX_SESSION_TTL_SECONDS {
        return Err(AuthDomainError::InvalidTtl);
    }

    Ok(ttl)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issues_and_parses_session_token() {
        let user_id = Uuid::new_v4();
        let session = issue_session(user_id, "device-1".to_string(), Some(3600))
            .expect("session should be issued");

        let parsed = parse_session_id(&session.token).expect("token should parse");
        assert_eq!(parsed, session.claims.session_id);
    }
}
