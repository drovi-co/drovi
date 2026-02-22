"""
Authentication Routes for Pilot Surface

Handles OAuth flow with PKCE:
- GET /login - Initiate OAuth flow
- GET /callback - Handle OAuth callback
- GET /me - Get current user info
- POST /logout - Clear session cookie
"""

import hashlib
import secrets
from base64 import urlsafe_b64encode
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text

from src.auth.pilot_accounts import (
    AuthError,
    OAuthUserInfo,
    PilotToken,
    create_jwt,
    handle_email_login,
    handle_email_signup,
    handle_oauth_callback,
    verify_jwt,
)
from src.config import get_settings
from src.notifications.resend import send_resend_email
from src.security.org_policy import get_org_security_policy

logger = structlog.get_logger()
router = APIRouter(prefix="/auth", tags=["auth"])

# =============================================================================
# Middleware Helper
# =============================================================================


async def require_pilot_auth(
    session: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
):
    """
    Dependency that requires valid pilot authentication.

    Accepts session token from either:
    - Cookie named "session"
    - Authorization header as "Bearer <token>"

    Use in routes that need org-scoped access:

    ```python
    @app.get("/api/v1/brief")
    async def get_brief(
        token: PilotToken = Depends(require_pilot_auth),
    ):
        org_id = token.org_id
        ...
    ```
    """
    # Try cookie first, then Authorization header
    token_str = session
    if not token_str and authorization:
        if authorization.startswith("Bearer "):
            token_str = authorization[7:]  # Remove "Bearer " prefix

    if not token_str:
        raise HTTPException(401, "Not authenticated")

    token = verify_jwt(token_str)
    if not token:
        raise HTTPException(401, "Invalid or expired session")

    # Re-validate membership on every request so role changes take effect
    # immediately and removed users cannot keep using a stale JWT.
    try:
        from src.db.client import get_db_session

        async with get_db_session() as db:
            result = await db.execute(
                text(
                    """
                    SELECT role
                    FROM memberships
                    WHERE user_id = :user_id AND org_id = :org_id
                    """
                ),
                {"user_id": token.sub, "org_id": token.org_id},
            )
            membership_row = result.fetchone()
    except Exception as exc:
        logger.warning("Failed to revalidate membership", error=str(exc))
        membership_row = None

    if not membership_row or not getattr(membership_row, "role", None):
        raise HTTPException(401, "Session no longer valid")

    current_role = str(membership_row.role)
    if current_role != token.role:
        token = token.model_copy(update={"role": current_role})

    if token.auth_method == "password":
        org_policy = await get_org_security_policy(token.org_id)
        if not org_policy.allows_password_auth(get_settings().environment):
            raise HTTPException(401, "Password sessions are disabled. Please sign in with SSO.")

    # Ensure all DB reads/writes in this request are scoped by org-level RLS.
    from src.db.rls import rls_context

    with rls_context(token.org_id, is_internal=False):
        yield token


# =============================================================================
# Models
# =============================================================================


class LoginResponse(BaseModel):
    """Response from login initiation."""

    auth_url: str
    state: str


class UserResponse(BaseModel):
    """Current user info with organization details."""

    user_id: str
    org_id: str
    org_name: str
    role: str
    email: str
    exp: datetime
    locale: str = "en"
    user_locale: str | None = None
    org_default_locale: str = "en"


class OrganizationMembershipResponse(BaseModel):
    """Organization membership visible to the authenticated user."""

    id: str
    name: str
    role: str
    status: str
    region: str | None = None
    created_at: datetime | None = None


class OrganizationsResponse(BaseModel):
    """List of organizations for the current authenticated user."""

    organizations: list[OrganizationMembershipResponse]
    active_org_id: str


class CallbackQuery(BaseModel):
    """OAuth callback query parameters."""

    code: str
    state: str


class EmailLoginRequest(BaseModel):
    """Email login request."""

    email: str
    password: str
    invite_token: str | None = None


class EmailSignupRequest(BaseModel):
    """Email signup request."""

    email: str
    password: str
    name: str | None = None
    organization_name: str | None = None
    invite_token: str | None = None


class EmailAuthResponse(BaseModel):
    """Response from email auth (login or signup)."""

    user: dict
    session_token: str
    organization: dict | None = None
    organizations: list[dict] | None = None


class UpdateLocaleRequest(BaseModel):
    """Update the user's preferred locale (overrides org default)."""

    locale: str | None = None


class SwitchOrganizationRequest(BaseModel):
    """Switch active organization for current session."""

    organization_id: str


class SwitchOrganizationResponse(BaseModel):
    """Session response after switching organization."""

    session_token: str
    active_org_id: str


class PasswordResetRequestBody(BaseModel):
    """Request password reset email for an account."""

    email: str


class PasswordResetRequestResponse(BaseModel):
    """Generic reset-request response (non-enumerating)."""

    ok: bool = True
    message: str = "If the account exists, a reset link has been sent."
    reset_token: str | None = None
    reset_link: str | None = None


class PasswordResetConfirmBody(BaseModel):
    """Confirm password reset with token + new password."""

    token: str
    new_password: str


class PasswordResetConfirmResponse(BaseModel):
    """Password reset completion response."""

    ok: bool = True


# =============================================================================
# Cookie Configuration
# =============================================================================

COOKIE_NAME = "session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def _set_session_cookie(response: Response, token: str) -> None:
    """Set secure session cookie."""
    settings = get_settings()
    is_production = settings.environment == "production"

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    """Clear session cookie."""
    response.delete_cookie(key=COOKIE_NAME, path="/")


# =============================================================================
# Organization Helpers
# =============================================================================


async def _list_user_organizations(user_id: str) -> list[OrganizationMembershipResponse]:
    """List active organizations for a user with membership roles."""
    from src.db.client import get_db_session
    from src.db.rls import rls_context

    with rls_context("internal", is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT
                        o.id,
                        o.name,
                        o.pilot_status,
                        o.region,
                        o.created_at,
                        m.role
                    FROM memberships m
                    JOIN organizations o ON o.id = m.org_id
                    WHERE m.user_id = :user_id
                      AND o.pilot_status = 'active'
                    ORDER BY m.created_at ASC
                    """
                ),
                {"user_id": user_id},
            )
            rows = result.fetchall()

    return [
        OrganizationMembershipResponse(
            id=row.id,
            name=row.name,
            role=row.role,
            status=row.pilot_status,
            region=row.region,
            created_at=row.created_at,
        )
        for row in rows
    ]


def _token_auth_method_for_jwt(token: PilotToken) -> str:
    """Map PilotToken auth method to JWT auth method."""
    return "password" if token.auth_method == "password" else "sso"


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _hash_password(password: str) -> str:
    """Hash a password using PBKDF2-SHA256."""
    salt = secrets.token_hex(16)
    iterations = 100000
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations)
    return f"pbkdf2:sha256:{iterations}${salt}${dk.hex()}"


def _build_reset_link(token: str) -> str | None:
    settings = get_settings()
    if not settings.web_app_url:
        return None
    base = settings.web_app_url.rstrip("/")
    return f"{base}/reset-password?token={token}"


# =============================================================================
# OAuth State Management (In-Memory for simplicity, use Redis in production)
# =============================================================================

# In production, this should be Redis with TTL
_oauth_states: dict[str, dict] = {}


def _store_oauth_state(state: str, data: dict) -> None:
    """Store OAuth state for validation."""
    _oauth_states[state] = {
        **data,
        "created_at": datetime.now(timezone.utc),
    }
    # Clean up old states (simple cleanup)
    _cleanup_old_states()


def _get_and_remove_oauth_state(state: str) -> dict | None:
    """Get and remove OAuth state."""
    return _oauth_states.pop(state, None)


def _cleanup_old_states() -> None:
    """Remove OAuth states older than 10 minutes."""
    now = datetime.now(timezone.utc)
    expired = [
        s
        for s, d in _oauth_states.items()
        if (now - d["created_at"]).seconds > 600
    ]
    for state in expired:
        _oauth_states.pop(state, None)


# =============================================================================
# PKCE Helpers
# =============================================================================


def _generate_code_verifier() -> str:
    """Generate PKCE code verifier (43-128 characters)."""
    return secrets.token_urlsafe(64)


def _generate_code_challenge(verifier: str) -> str:
    """Generate PKCE code challenge (SHA256, base64url)."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return urlsafe_b64encode(digest).decode().rstrip("=")


# =============================================================================
# Routes
# =============================================================================


@router.get("/login", response_model=LoginResponse)
async def login(
    provider: str = Query(default="google", description="OAuth provider"),
    redirect_uri: str | None = Query(default=None, description="OAuth redirect URI"),
) -> LoginResponse:
    """
    Initiate OAuth login flow.

    Returns the authorization URL to redirect the user to.
    """
    settings = get_settings()

    if provider != "google":
        raise HTTPException(400, "Only Google OAuth is currently supported")

    # Generate PKCE parameters
    code_verifier = _generate_code_verifier()
    code_challenge = _generate_code_challenge(code_verifier)
    state = secrets.token_urlsafe(32)

    # Determine redirect URI
    if not redirect_uri:
        redirect_uri = f"{settings.api_base_url}/api/v1/auth/callback"

    # Store state for validation
    _store_oauth_state(
        state,
        {
            "code_verifier": code_verifier,
            "redirect_uri": redirect_uri,
            "provider": provider,
        },
    )

    # Build Google OAuth URL
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "access_type": "offline",
        "prompt": "consent",
    }

    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    logger.info("OAuth login initiated", provider=provider, state=state[:8] + "...")

    return LoginResponse(auth_url=auth_url, state=state)


@router.post("/login/email", response_model=EmailAuthResponse)
async def login_with_email(
    request: EmailLoginRequest,
    response: Response,
) -> EmailAuthResponse:
    """
    Login with email and password.

    Returns session token and user info.
    """
    try:
        auth_result = await handle_email_login(
            request.email,
            request.password,
            invite_token=request.invite_token,
        )

        # Get organization info
        from src.auth.pilot_accounts import get_org_by_id

        org = await get_org_by_id(auth_result.org_id)

        user_dict = {
            "id": auth_result.user_id,
            "email": auth_result.email,
            "name": auth_result.name,
            "role": auth_result.role,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        org_dict = None
        if org:
            org_dict = {
                "id": org["id"],
                "name": org["name"],
                "status": org.get("pilot_status", "active"),
                "region": org.get("region"),
                "created_at": org.get("created_at", datetime.now(timezone.utc)).isoformat()
                if isinstance(org.get("created_at"), datetime)
                else datetime.now(timezone.utc).isoformat(),
            }

        _set_session_cookie(response, auth_result.token)

        logger.info("Email login successful", user_id=auth_result.user_id)

        return EmailAuthResponse(
            user=user_dict,
            session_token=auth_result.token,
            organization=org_dict,
            organizations=[org_dict] if org_dict else [],
        )
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error("Email login error", error=str(e))
        raise HTTPException(status_code=500, detail="Login failed")


@router.post("/signup/email", response_model=EmailAuthResponse)
async def signup_with_email(
    request: EmailSignupRequest,
    response: Response,
) -> EmailAuthResponse:
    """
    Create a new account with email and password.

    Creates a new user and a personal organization.
    Returns session token and user info.
    """
    if len(request.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    try:
        auth_result = await handle_email_signup(
            email=request.email,
            password=request.password,
            name=request.name,
            organization_name=request.organization_name,
            invite_token=request.invite_token,
        )

        # Get organization info
        from src.auth.pilot_accounts import get_org_by_id

        org = await get_org_by_id(auth_result.org_id)

        user_dict = {
            "id": auth_result.user_id,
            "email": auth_result.email,
            "name": auth_result.name,
            "role": auth_result.role,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        org_dict = None
        if org:
            org_dict = {
                "id": org["id"],
                "name": org["name"],
                "status": org.get("pilot_status", "active"),
                "region": org.get("region"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        _set_session_cookie(response, auth_result.token)

        logger.info("Email signup successful", user_id=auth_result.user_id)

        return EmailAuthResponse(
            user=user_dict,
            session_token=auth_result.token,
            organization=org_dict,
            organizations=[org_dict] if org_dict else [],
        )
    except AuthError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error("Email signup error", error=str(e))
        raise HTTPException(status_code=500, detail="Signup failed")


@router.get("/callback")
async def callback(
    code: str = Query(..., description="OAuth authorization code"),
    state: str = Query(..., description="OAuth state parameter"),
) -> Response:
    """
    Handle OAuth callback.

    Handles both login OAuth and connector OAuth:
    - Login OAuth: Exchanges code for tokens, validates user, sets session cookie
    - Connector OAuth: Exchanges code for API tokens, creates connection

    Redirects to the frontend when complete.
    """
    from fastapi.responses import RedirectResponse
    import json
    import redis.asyncio as redis

    settings = get_settings()

    # First check memory (login OAuth)
    oauth_state = _get_and_remove_oauth_state(state)

    # If not in memory, check Redis (connector OAuth)
    if not oauth_state:
        try:
            redis_client = redis.from_url(str(settings.redis_url))
            connector_state_data = await redis_client.get(f"oauth_state:{state}")
            await redis_client.aclose()

            if connector_state_data:
                connector_state = json.loads(connector_state_data)
                # This is a connector OAuth - handle it differently
                return await _handle_connector_callback(code, state, connector_state)
        except Exception as e:
            logger.warning("Redis check failed for connector OAuth", error=str(e))

    if not oauth_state:
        # Redirect to frontend with error
        return RedirectResponse(url="/?error=invalid_state", status_code=302)

    code_verifier = oauth_state["code_verifier"]
    redirect_uri = oauth_state["redirect_uri"]

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "code_verifier": code_verifier,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                },
            )

            if token_response.status_code != 200:
                logger.warning(
                    "OAuth token exchange failed",
                    status=token_response.status_code,
                    response=token_response.text[:200],
                )
                return RedirectResponse(url="/?error=token_exchange_failed", status_code=302)

            tokens = token_response.json()

            # Get user info
            userinfo_response = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )

            if userinfo_response.status_code != 200:
                return RedirectResponse(url="/?error=userinfo_failed", status_code=302)

            userinfo = userinfo_response.json()

        # Handle authentication
        auth_result = await handle_oauth_callback(
            OAuthUserInfo(
                email=userinfo["email"],
                name=userinfo.get("name"),
                picture=userinfo.get("picture"),
                provider="google",
            )
        )
    except AuthError as e:
        logger.warning("Auth error", error=e.message)
        return RedirectResponse(url=f"/?error={e.message}", status_code=302)
    except Exception as e:
        logger.error("OAuth callback error", error=str(e))
        return RedirectResponse(url="/?error=auth_failed", status_code=302)

    # Create redirect response with session cookie
    response = RedirectResponse(url="/", status_code=302)
    _set_session_cookie(response, auth_result.token)

    logger.info(
        "OAuth callback successful",
        user_id=auth_result.user_id,
        org_id=auth_result.org_id,
        is_new_user=auth_result.is_new_user,
    )

    return response


@router.get("/me", response_model=UserResponse)
async def get_me(
    token: PilotToken = Depends(require_pilot_auth),
) -> UserResponse:
    """
    Get current authenticated user.

    Accepts session token from either cookie or Authorization header.
    Returns user info with organization name.
    """
    # Fetch organization name
    from src.auth.pilot_accounts import get_org_by_id

    org = await get_org_by_id(token.org_id)
    org_name = org["name"] if org else "Unknown Organization"
    org_default_locale = (org or {}).get("default_locale") or "en"

    # Resolve user locale override (if set).
    user_locale = None
    try:
        from src.db.client import get_db_session

        async with get_db_session() as session:
            result = await session.execute(
                text("SELECT locale FROM users WHERE id = :user_id"),
                {"user_id": token.sub},
            )
            row = result.fetchone()
            user_locale = getattr(row, "locale", None) if row else None
    except Exception as exc:
        logger.warning("Failed to resolve user locale", error=str(exc))

    effective_locale = str(user_locale or org_default_locale or "en")

    return UserResponse(
        user_id=token.sub,
        org_id=token.org_id,
        org_name=org_name,
        role=token.role,
        email=token.email,
        exp=token.exp,
        locale=effective_locale,
        user_locale=user_locale,
        org_default_locale=str(org_default_locale or "en"),
    )


@router.get("/organizations", response_model=OrganizationsResponse)
async def list_my_organizations(
    token: PilotToken = Depends(require_pilot_auth),
) -> OrganizationsResponse:
    """List active organizations for the authenticated user."""
    organizations = await _list_user_organizations(token.sub)
    if not organizations:
        raise HTTPException(status_code=403, detail="No active organization memberships found")

    active_org_id = token.org_id
    if not any(org.id == active_org_id for org in organizations):
        active_org_id = organizations[0].id

    return OrganizationsResponse(
        organizations=organizations,
        active_org_id=active_org_id,
    )


@router.post("/switch-organization", response_model=SwitchOrganizationResponse)
async def switch_organization(
    request: SwitchOrganizationRequest,
    response: Response,
    token: PilotToken = Depends(require_pilot_auth),
) -> SwitchOrganizationResponse:
    """
    Switch the active organization for the current authenticated session.

    Issues a fresh session JWT scoped to the target organization and sets it as
    the current cookie session.
    """
    organizations = await _list_user_organizations(token.sub)
    target = next((org for org in organizations if org.id == request.organization_id), None)
    if not target:
        raise HTTPException(status_code=403, detail="Not a member of the requested organization")

    if token.auth_method == "password":
        org_policy = await get_org_security_policy(target.id)
        if not org_policy.allows_password_auth(get_settings().environment):
            raise HTTPException(
                status_code=403,
                detail="Password sessions are disabled for this organization. Use SSO sign-in.",
            )

    session_token = create_jwt(
        user_id=token.sub,
        org_id=target.id,
        role=target.role,
        email=token.email,
        auth_method=_token_auth_method_for_jwt(token),
    )
    _set_session_cookie(response, session_token)

    logger.info(
        "Switched active organization",
        user_id=token.sub,
        previous_org_id=token.org_id,
        next_org_id=target.id,
    )

    return SwitchOrganizationResponse(
        session_token=session_token,
        active_org_id=target.id,
    )


@router.post("/password-reset/request", response_model=PasswordResetRequestResponse)
async def request_password_reset(
    request: PasswordResetRequestBody,
) -> PasswordResetRequestResponse:
    """
    Request password reset.

    Always returns a generic success response to avoid account enumeration.
    """
    from src.db.client import get_db_session
    from src.db.rls import rls_context

    email = (request.email or "").strip().lower()
    if not email:
        return PasswordResetRequestResponse()

    reset_token: str | None = None
    reset_link: str | None = None

    try:
        with rls_context("internal", is_internal=True):
            async with get_db_session() as session:
                user_result = await session.execute(
                    text(
                        """
                        SELECT id, email
                        FROM users
                        WHERE lower(email) = :email
                        LIMIT 1
                        """
                    ),
                    {"email": email},
                )
                user = user_result.fetchone()

                if user:
                    reset_token = secrets.token_urlsafe(32)
                    reset_hash = _hash_reset_token(reset_token)
                    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

                    await session.execute(
                        text(
                            """
                            UPDATE password_reset_token
                            SET used_at = NOW()
                            WHERE user_id = :user_id
                              AND used_at IS NULL
                            """
                        ),
                        {"user_id": user.id},
                    )

                    await session.execute(
                        text(
                            """
                            INSERT INTO password_reset_token (
                                id,
                                user_id,
                                token_hash,
                                expires_at,
                                created_at
                            ) VALUES (
                                :id,
                                :user_id,
                                :token_hash,
                                :expires_at,
                                NOW()
                            )
                            """
                        ),
                        {
                            "id": f"prt_{secrets.token_hex(12)}",
                            "user_id": user.id,
                            "token_hash": reset_hash,
                            "expires_at": expires_at,
                        },
                    )

        if reset_token:
            reset_link = _build_reset_link(reset_token)
            if reset_link:
                subject = "Reset your Drovi password"
                text_body = (
                    "We received a request to reset your password.\n\n"
                    f"Reset link: {reset_link}\n\n"
                    "If you did not request this change, you can ignore this email."
                )
                html_body = (
                    "<div style=\"font-family:ui-sans-serif,system-ui;line-height:1.5;\">"
                    "<h2 style=\"margin:0 0 12px 0;\">Reset your password</h2>"
                    "<p style=\"margin:0 0 12px 0;\">We received a request to reset your password.</p>"
                    f"<p style=\"margin:0 0 12px 0;\"><a href=\"{reset_link}\">Set a new password</a></p>"
                    "<p style=\"margin:0; color:#6b7280; font-size:12px;\">"
                    "If you did not request this change, you can ignore this email."
                    "</p></div>"
                )
                await send_resend_email(
                    to_emails=[email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                    tags={"type": "password_reset"},
                )

    except Exception as exc:
        logger.error("Password reset request failed", email=email, error=str(exc))

    response = PasswordResetRequestResponse()
    if get_settings().environment != "production":
        response.reset_token = reset_token
        response.reset_link = reset_link
    return response


@router.post("/password-reset/confirm", response_model=PasswordResetConfirmResponse)
async def confirm_password_reset(
    request: PasswordResetConfirmBody,
) -> PasswordResetConfirmResponse:
    """Confirm password reset by token and set new password hash."""
    from src.db.client import get_db_session
    from src.db.rls import rls_context

    token_value = (request.token or "").strip()
    new_password = request.new_password or ""
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(new_password) > 256:
        raise HTTPException(status_code=400, detail="Password is too long")
    if not token_value:
        raise HTTPException(status_code=400, detail="Reset token is required")

    token_hash = _hash_reset_token(token_value)
    now = datetime.now(timezone.utc)

    with rls_context("internal", is_internal=True):
        async with get_db_session() as session:
            token_result = await session.execute(
                text(
                    """
                    SELECT id, user_id, expires_at, used_at
                    FROM password_reset_token
                    WHERE token_hash = :token_hash
                    LIMIT 1
                    """
                ),
                {"token_hash": token_hash},
            )
            token_row = token_result.fetchone()
            if not token_row:
                raise HTTPException(status_code=400, detail="Invalid reset token")

            if token_row.used_at is not None:
                raise HTTPException(status_code=400, detail="Reset token has already been used")

            expires_at = token_row.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < now:
                raise HTTPException(status_code=400, detail="Reset token has expired")

            password_hash = _hash_password(new_password)

            await session.execute(
                text(
                    """
                    UPDATE users
                    SET password_hash = :password_hash
                    WHERE id = :user_id
                    """
                ),
                {"password_hash": password_hash, "user_id": token_row.user_id},
            )

            await session.execute(
                text(
                    """
                    UPDATE password_reset_token
                    SET used_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": token_row.id},
            )
            await session.execute(
                text(
                    """
                    UPDATE password_reset_token
                    SET used_at = NOW()
                    WHERE user_id = :user_id
                      AND id <> :id
                      AND used_at IS NULL
                    """
                ),
                {"user_id": token_row.user_id, "id": token_row.id},
            )

    return PasswordResetConfirmResponse(ok=True)


@router.patch("/me/locale")
async def update_my_locale(
    request: UpdateLocaleRequest,
    token: PilotToken = Depends(require_pilot_auth),
) -> dict:
    """Update the authenticated user's locale preference."""
    locale = (request.locale or "").strip().lower()
    if locale and not (locale.startswith("en") or locale.startswith("fr")):
        raise HTTPException(status_code=400, detail="Unsupported locale")

    value = None
    if locale:
        value = "fr" if locale.startswith("fr") else "en"

    try:
        from src.db.client import get_db_session

        async with get_db_session() as session:
            await session.execute(
                text("UPDATE users SET locale = :locale WHERE id = :user_id"),
                {"locale": value, "user_id": token.sub},
            )
            await session.commit()
    except Exception as exc:
        logger.error("Failed to update user locale", error=str(exc))
        raise HTTPException(status_code=500, detail="Failed to update locale") from exc

    return {"ok": True, "locale": value}


@router.post("/logout")
async def logout(response: Response) -> dict:
    """
    Logout current user.

    Clears session cookie.
    """
    _clear_session_cookie(response)

    return {"success": True}


# =============================================================================
# Connector OAuth Callback Handler
# =============================================================================


async def _exchange_oauth_code(
    provider: str,
    code: str,
    code_verifier: str | None,
    redirect_uri: str,
    settings: any,
) -> dict | None:
    """
    Exchange OAuth authorization code for tokens.

    Returns dict with: access_token, refresh_token (optional), email (optional),
    scopes, oauth_provider (the underlying OAuth provider like 'google', 'microsoft', etc.)
    """
    async with httpx.AsyncClient() as client:
        # Google-based providers (Gmail, Docs, Calendar)
        if provider in ("gmail", "google_docs", "google_calendar"):
            token_response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "code": code,
                    "code_verifier": code_verifier,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                },
            )

            if token_response.status_code != 200:
                logger.warning(
                    "Google token exchange failed",
                    provider=provider,
                    status=token_response.status_code,
                    response=token_response.text[:200],
                )
                return None

            tokens = token_response.json()

            # Get user's email
            userinfo_response = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            email = None
            if userinfo_response.status_code == 200:
                userinfo = userinfo_response.json()
                email = userinfo.get("email")

            scope_map = {
                "gmail": ["gmail.readonly"],
                "google_docs": ["drive.readonly", "documents.readonly"],
                "google_calendar": ["calendar.readonly"],
            }

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": tokens.get("refresh_token"),
                "expires_in": tokens.get("expires_in"),
                "email": email,
                "scopes": scope_map.get(provider, []),
                "oauth_provider": "google",
            }

        # Slack
        if provider == "slack":
            token_response = await client.post(
                "https://slack.com/api/oauth.v2.access",
                data={
                    "client_id": settings.slack_client_id,
                    "client_secret": settings.slack_client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )

            if token_response.status_code != 200:
                return None

            tokens = token_response.json()
            if not tokens.get("ok"):
                logger.warning("Slack OAuth error", error=tokens.get("error"))
                return None

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": None,
                "expires_in": tokens.get("expires_in"),
                "email": None,
                "scopes": ["channels:history", "channels:read", "users:read"],
                "oauth_provider": "slack",
            }

        # Microsoft-based providers (Outlook, Teams)
        if provider in ("outlook", "teams"):
            import base64
            import json

            tenant = settings.microsoft_tenant_id or "common"
            token_response = await client.post(
                f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
                data={
                    "client_id": settings.microsoft_client_id,
                    "client_secret": settings.microsoft_client_secret,
                    "code": code,
                    "code_verifier": code_verifier,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                },
            )

            if token_response.status_code != 200:
                logger.warning(
                    "Microsoft token exchange failed",
                    provider=provider,
                    status=token_response.status_code,
                    response=token_response.text[:200],
                )
                return None

            tokens = token_response.json()

            # Get user info from Microsoft Graph
            userinfo_response = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            email = None
            microsoft_user_id = None
            user_principal_name = None
            if userinfo_response.status_code == 200:
                userinfo = userinfo_response.json()
                microsoft_user_id = userinfo.get("id")
                user_principal_name = userinfo.get("userPrincipalName")
                email = userinfo.get("mail") or user_principal_name

            tenant_id = None
            access_token = tokens.get("access_token")
            if isinstance(access_token, str) and access_token:
                try:
                    payload_segment = access_token.split(".")[1]
                    payload_segment += "=" * (-len(payload_segment) % 4)
                    claims = json.loads(base64.urlsafe_b64decode(payload_segment.encode()).decode())
                    tenant_claim = claims.get("tid")
                    if isinstance(tenant_claim, str) and tenant_claim:
                        tenant_id = tenant_claim
                except Exception:
                    tenant_id = None

            scope_map = {
                "outlook": ["Mail.Read"],
                "teams": ["ChannelMessage.Read.All", "Chat.Read"],
            }

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": tokens.get("refresh_token"),
                "expires_in": tokens.get("expires_in"),
                "email": email,
                "scopes": scope_map.get(provider, []),
                "oauth_provider": "microsoft",
                "connection_metadata": {
                    "tenant_id": tenant_id,
                    "microsoft_user_id": microsoft_user_id,
                    "user_principal_name": user_principal_name,
                    "email_address": email,
                },
            }

        # Notion
        if provider == "notion":
            # Notion uses Basic Auth for token exchange
            import base64
            credentials = base64.b64encode(
                f"{settings.notion_client_id}:{settings.notion_client_secret}".encode()
            ).decode()

            token_response = await client.post(
                "https://api.notion.com/v1/oauth/token",
                headers={
                    "Authorization": f"Basic {credentials}",
                    "Content-Type": "application/json",
                },
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )

            if token_response.status_code != 200:
                logger.warning(
                    "Notion token exchange failed",
                    status=token_response.status_code,
                    response=token_response.text[:200],
                )
                return None

            tokens = token_response.json()

            # Notion returns workspace info in token response
            owner = tokens.get("owner", {})
            email = None
            if owner.get("type") == "user":
                user = owner.get("user", {})
                email = user.get("person", {}).get("email")

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": None,  # Notion doesn't use refresh tokens
                "expires_in": tokens.get("expires_in"),
                "email": email,
                "scopes": ["read_content"],
                "oauth_provider": "notion",
                "connection_metadata": {
                    "workspace_id": tokens.get("workspace_id"),
                    "workspace_name": tokens.get("workspace_name"),
                    "workspace_icon": tokens.get("workspace_icon"),
                    "workspace_type": tokens.get("workspace_type"),
                    "bot_id": tokens.get("bot_id"),
                },
            }

        # HubSpot
        if provider == "hubspot":
            token_response = await client.post(
                "https://api.hubapi.com/oauth/v1/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.hubspot_client_id,
                    "client_secret": settings.hubspot_client_secret,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )

            if token_response.status_code != 200:
                logger.warning(
                    "HubSpot token exchange failed",
                    status=token_response.status_code,
                    response=token_response.text[:200],
                )
                return None

            tokens = token_response.json()

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": tokens.get("refresh_token"),
                "expires_in": tokens.get("expires_in"),
                "email": None,
                "scopes": ["crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read"],
                "oauth_provider": "hubspot",
            }

        # WhatsApp Business (via Meta)
        if provider == "whatsapp":
            token_response = await client.get(
                "https://graph.facebook.com/v18.0/oauth/access_token",
                params={
                    "client_id": settings.meta_app_id,
                    "client_secret": settings.meta_app_secret,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )

            if token_response.status_code != 200:
                logger.warning(
                    "Meta token exchange failed",
                    status=token_response.status_code,
                    response=token_response.text[:200],
                )
                return None

            tokens = token_response.json()

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": None,
                "expires_in": tokens.get("expires_in"),
                "email": None,
                "scopes": ["whatsapp_business_messaging"],
                "oauth_provider": "meta",
            }

        logger.warning("Unsupported provider for OAuth", provider=provider)
        return None


async def _handle_connector_callback(
    code: str,
    state: str,
    connector_state: dict,
) -> Response:
    """
    Handle OAuth callback for data source connectors.

    Supports: gmail, slack, outlook, teams, notion, whatsapp, google_docs, hubspot, google_calendar

    Exchanges the code for API tokens and creates a connection record.
    """
    from fastapi.responses import RedirectResponse
    from uuid import uuid4
    import json
    import redis.asyncio as redis

    settings = get_settings()
    provider = connector_state.get("provider", "gmail")
    org_id = connector_state.get("org_id")
    code_verifier = connector_state.get("code_verifier")
    redirect_uri = connector_state.get("redirect_uri")
    restricted_labels = connector_state.get("restricted_labels", [])
    restricted_channels = connector_state.get("restricted_channels", [])
    return_to = connector_state.get("return_to")
    created_by_user_id = connector_state.get("created_by_user_id")
    visibility = connector_state.get("visibility") or "org_shared"
    if visibility not in ("org_shared", "private"):
        visibility = "org_shared"

    def _build_redirect_url(status_param: str) -> str:
        base_path = return_to if isinstance(return_to, str) and return_to.startswith("/") else "/"
        separator = "&" if "?" in base_path else "?"
        return f"{base_path}{separator}{status_param}"

    if not org_id:
        logger.warning("Connector OAuth missing org_id", state=state[:8])
        return RedirectResponse(url=_build_redirect_url("error=missing_org_id"), status_code=302)

    try:
        # Exchange code for tokens based on provider
        token_result = await _exchange_oauth_code(
            provider=provider,
            code=code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            settings=settings,
        )

        if token_result is None:
            return RedirectResponse(
                url=_build_redirect_url("error=connector_token_exchange_failed"),
                status_code=302,
            )

        access_token = token_result["access_token"]
        refresh_token = token_result.get("refresh_token")
        expires_in = token_result.get("expires_in")
        email = token_result.get("email")
        scopes = token_result.get("scopes", [])
        oauth_provider = token_result.get("oauth_provider", provider)
        connection_metadata = token_result.get("connection_metadata") or {}

        expires_at = None
        if expires_in is not None:
            try:
                expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
            except Exception:
                expires_at = None

        # Store connection in database
        from src.db.client import get_db_session
        from src.connectors.auth.token_crypto import encrypt_connector_token

        access_token_encrypted = encrypt_connector_token(access_token)
        refresh_token_encrypted = (
            encrypt_connector_token(refresh_token) if refresh_token else None
        )

        connection_id = str(uuid4())
        oauth_token_id = str(uuid4())

        # Build connection name
        if email:
            connection_name = f"{provider.replace('_', ' ').title()} - {email}"
        else:
            connection_name = provider.replace("_", " ").title()

        config_payload: dict[str, Any] = {
            "email": email,
            "restricted_labels": restricted_labels,
            "restricted_channels": restricted_channels,
            "scopes": scopes,
        }
        if isinstance(connection_metadata, dict):
            for key, value in connection_metadata.items():
                if value is not None:
                    config_payload[key] = value

        async with get_db_session() as session:
            # Create connection record
            await session.execute(
                text("""
                    INSERT INTO connections (
                        id, organization_id, connector_type, name, config,
                        status, sync_enabled, created_at, updated_at,
                        created_by_user_id, visibility
                    ) VALUES (
                        :id, :org_id, :connector_type, :name, :config,
                        'active', true, NOW(), NOW(),
                        :created_by_user_id, :visibility
                    )
                """),
                {
                    "id": connection_id,
                    "org_id": org_id,
                    "connector_type": provider,
                    "name": connection_name,
                    "config": json.dumps(config_payload),
                    "created_by_user_id": created_by_user_id,
                    "visibility": visibility,
                },
            )

            # Create oauth_tokens record
            await session.execute(
                text("""
                    INSERT INTO oauth_tokens (
                        id, connection_id, organization_id, provider,
                        access_token_encrypted, refresh_token_encrypted,
                        token_type, expires_at, scopes, created_at, updated_at
                    ) VALUES (
                        :id, :connection_id, :org_id, :provider,
                        :access_token, :refresh_token,
                        'Bearer', :expires_at, :scopes, NOW(), NOW()
                    )
                """),
                {
                    "id": oauth_token_id,
                    "connection_id": connection_id,
                    "org_id": org_id,
                    "provider": oauth_provider,
                    "access_token": access_token_encrypted,
                    "refresh_token": refresh_token_encrypted,
                    "expires_at": expires_at,
                    "scopes": scopes,
                },
            )

            await session.commit()

        # Clean up Redis state
        redis_client = redis.from_url(str(settings.redis_url))
        await redis_client.delete(f"oauth_state:{state}")
        await redis_client.aclose()

        logger.info(
            "Connector OAuth successful",
            provider=provider,
            org_id=org_id,
            connection_id=connection_id,
            email=email,
        )

        try:
            from src.audit.log import record_audit_event

            await record_audit_event(
                organization_id=org_id,
                action="connection.connected",
                actor_type="user" if created_by_user_id else "system",
                actor_id=created_by_user_id,
                resource_type="connection",
                resource_id=str(connection_id),
                metadata={
                    "provider": provider,
                    "visibility": visibility,
                    "email": email,
                },
            )
        except Exception as audit_error:
            logger.warning(
                "Failed to record audit event for connection connect",
                connection_id=connection_id,
                error=str(audit_error),
            )

        # Trigger initial ingestion via the durable job plane.
        #
        # This makes the "connect -> data appears" path restart-safe and keeps
        # long-running work out of the API process.
        try:
            from datetime import timedelta

            from src.jobs.queue import EnqueueJobRequest, enqueue_job

            # 1) Fast-path sync: pull the most recent window first so the user sees value quickly.
            initial_sync_job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=org_id,
                    job_type="connector.sync",
                    payload={
                        "connection_id": connection_id,
                        "organization_id": org_id,
                        "streams": None,
                        "full_refresh": True,
                        "scheduled": False,
                    },
                    priority=2,
                    max_attempts=3,
                    idempotency_key=f"initial_sync:{connection_id}",
                    resource_key=f"connection:{connection_id}",
                )
            )

            # 2) Historical backfill: run a bounded default window (90d) in the background.
            backfill_start = (datetime.utcnow() - timedelta(days=90)).isoformat()
            initial_backfill_job_id = await enqueue_job(
                EnqueueJobRequest(
                    organization_id=org_id,
                    job_type="connector.backfill_plan",
                    payload={
                        "connection_id": connection_id,
                        "organization_id": org_id,
                        "start_date": backfill_start,
                        "end_date": None,
                        "window_days": None,
                        "streams": None,
                        "throttle_seconds": None,
                    },
                    priority=1,
                    max_attempts=2,
                    idempotency_key=f"initial_backfill:{connection_id}",
                    resource_key=f"connection:{connection_id}",
                )
            )

            logger.info(
                "Initial ingestion enqueued",
                connection_id=connection_id,
                initial_sync_job_id=initial_sync_job_id,
                initial_backfill_job_id=initial_backfill_job_id,
            )
        except Exception as sync_error:
            # Don't fail the OAuth flow if sync fails to start
            # The user can manually trigger sync later
            logger.warning(
                "Failed to enqueue initial ingestion",
                connection_id=connection_id,
                error=str(sync_error),
            )

        # Redirect to frontend with success
        return RedirectResponse(url=_build_redirect_url("connection=success"), status_code=302)

    except Exception as e:
        logger.error("Connector OAuth failed", provider=provider, error=str(e))
        return RedirectResponse(
            url=_build_redirect_url("error=connector_failed"),
            status_code=302,
        )
