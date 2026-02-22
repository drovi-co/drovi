use chrono::{DateTime, Duration, Utc};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rsa::{
    pkcs1v15::{Signature as RsaSignature, VerifyingKey},
    signature::Verifier,
    BigUint, RsaPublicKey,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AuthDomainError {
    #[error("invalid identity token")]
    InvalidIdentityToken,
    #[error("apple identity audience is not configured")]
    AppleIdentityAudienceNotConfigured,
    #[error("apple identity provider unavailable")]
    AppleIdentityProviderUnavailable,
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
const APPLE_ISSUER: &str = "https://appleid.apple.com";
const APPLE_JWKS_URL: &str = "https://appleid.apple.com/auth/keys";

#[derive(Debug, Deserialize)]
struct AppleJwksResponse {
    keys: Vec<AppleJwk>,
}

#[derive(Debug, Deserialize)]
struct AppleJwk {
    kid: String,
    n: String,
    e: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AppleIdentityTokenClaims {
    sub: String,
    email: Option<String>,
    iss: String,
    aud: Value,
    iat: i64,
    exp: i64,
}

#[derive(Debug, Clone, Deserialize)]
struct AppleIdentityTokenHeader {
    kid: String,
    alg: String,
}

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

pub async fn verify_apple_identity_token(
    identity_token: &str,
    expected_audience: &str,
) -> Result<AppleIdentityAssertion, AuthDomainError> {
    if expected_audience.trim().is_empty() {
        return Err(AuthDomainError::AppleIdentityAudienceNotConfigured);
    }

    let (header_part, claims_part, signature_part) =
        split_identity_token(identity_token).ok_or(AuthDomainError::InvalidIdentityToken)?;

    let header = decode_base64_json::<AppleIdentityTokenHeader>(header_part)
        .ok_or(AuthDomainError::InvalidIdentityToken)?;
    if header.alg != "RS256" {
        return Err(AuthDomainError::InvalidIdentityToken);
    }

    let jwks = fetch_apple_jwks().await?;
    let jwk = jwks
        .keys
        .into_iter()
        .find(|entry| entry.kid == header.kid)
        .ok_or(AuthDomainError::InvalidIdentityToken)?;

    verify_signature(header_part, claims_part, signature_part, &jwk)?;

    let claims = decode_base64_json::<AppleIdentityTokenClaims>(claims_part)
        .ok_or(AuthDomainError::InvalidIdentityToken)?;
    if claims.iss != APPLE_ISSUER {
        return Err(AuthDomainError::InvalidIdentityToken);
    }
    if !audience_matches(&claims.aud, expected_audience) {
        return Err(AuthDomainError::InvalidIdentityToken);
    }

    let issued_at =
        DateTime::from_timestamp(claims.iat, 0).ok_or(AuthDomainError::InvalidIdentityToken)?;
    let expires_at =
        DateTime::from_timestamp(claims.exp, 0).ok_or(AuthDomainError::InvalidIdentityToken)?;
    if !token_is_time_valid(issued_at, expires_at) {
        return Err(AuthDomainError::InvalidIdentityToken);
    }

    Ok(AppleIdentityAssertion {
        subject: claims.sub,
        email: claims.email,
        issued_at,
        expires_at,
    })
}

fn split_identity_token(token: &str) -> Option<(&str, &str, &str)> {
    let mut parts = token.split('.');
    let header = parts.next()?;
    let payload = parts.next()?;
    let signature = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    Some((header, payload, signature))
}

fn decode_base64_json<T>(part: &str) -> Option<T>
where
    T: for<'de> Deserialize<'de>,
{
    let raw = URL_SAFE_NO_PAD.decode(part).ok()?;
    serde_json::from_slice::<T>(&raw).ok()
}

fn verify_signature(
    header_part: &str,
    claims_part: &str,
    signature_part: &str,
    jwk: &AppleJwk,
) -> Result<(), AuthDomainError> {
    let modulus = URL_SAFE_NO_PAD
        .decode(&jwk.n)
        .map_err(|_| AuthDomainError::InvalidIdentityToken)?;
    let exponent = URL_SAFE_NO_PAD
        .decode(&jwk.e)
        .map_err(|_| AuthDomainError::InvalidIdentityToken)?;
    let signature_raw = URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| AuthDomainError::InvalidIdentityToken)?;

    let public_key = RsaPublicKey::new(
        BigUint::from_bytes_be(&modulus),
        BigUint::from_bytes_be(&exponent),
    )
    .map_err(|_| AuthDomainError::InvalidIdentityToken)?;
    let verifying_key = VerifyingKey::<Sha256>::new(public_key);
    let signature = RsaSignature::try_from(signature_raw.as_slice())
        .map_err(|_| AuthDomainError::InvalidIdentityToken)?;

    let signed_payload = format!("{header_part}.{claims_part}");
    verifying_key
        .verify(signed_payload.as_bytes(), &signature)
        .map_err(|_| AuthDomainError::InvalidIdentityToken)
}

fn audience_matches(aud: &Value, expected_audience: &str) -> bool {
    match aud {
        Value::String(value) => value == expected_audience,
        Value::Array(values) => values
            .iter()
            .filter_map(Value::as_str)
            .any(|value| value == expected_audience),
        _ => false,
    }
}

fn token_is_time_valid(issued_at: DateTime<Utc>, expires_at: DateTime<Utc>) -> bool {
    let now = Utc::now();
    let leeway = Duration::seconds(60);
    issued_at <= now + leeway && expires_at >= now - leeway
}

async fn fetch_apple_jwks() -> Result<AppleJwksResponse, AuthDomainError> {
    let response = reqwest::Client::new()
        .get(APPLE_JWKS_URL)
        .send()
        .await
        .map_err(|_| AuthDomainError::AppleIdentityProviderUnavailable)?;

    if !response.status().is_success() {
        return Err(AuthDomainError::AppleIdentityProviderUnavailable);
    }

    response
        .json::<AppleJwksResponse>()
        .await
        .map_err(|_| AuthDomainError::AppleIdentityProviderUnavailable)
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
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;

    #[test]
    fn issues_and_parses_session_token() {
        let user_id = Uuid::new_v4();
        let session = issue_session(user_id, "device-1".to_string(), Some(3600))
            .expect("session should be issued");

        let parsed = parse_session_id(&session.token).expect("token should parse");
        assert_eq!(parsed, session.claims.session_id);
    }

    #[tokio::test]
    async fn verify_apple_identity_rejects_blank_audience() {
        let err = verify_apple_identity_token("not.a.jwt", " ")
            .await
            .expect_err("blank audience must fail before verification");

        assert!(matches!(
            err,
            AuthDomainError::AppleIdentityAudienceNotConfigured
        ));
    }

    #[tokio::test]
    async fn verify_apple_identity_rejects_non_rs256_header_without_network() {
        let header = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({"kid": "kid_1", "alg": "HS256"}))
                .expect("header json"),
        );
        let claims = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "sub": "user_123",
                "email": "user@example.com",
                "iss": APPLE_ISSUER,
                "aud": "com.example.imperium",
                "iat": 1_700_000_000_i64,
                "exp": 1_900_000_000_i64
            }))
            .expect("claims json"),
        );
        let signature = "invalid_signature";
        let token = format!("{header}.{claims}.{signature}");

        let err = verify_apple_identity_token(&token, "com.example.imperium")
            .await
            .expect_err("non-RS256 header should be rejected");

        assert!(matches!(err, AuthDomainError::InvalidIdentityToken));
    }
}
