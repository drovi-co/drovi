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
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
import structlog
from fastapi import APIRouter, Cookie, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import text

from src.auth.pilot_accounts import (
    AuthError,
    OAuthUserInfo,
    PilotToken,
    handle_oauth_callback,
    verify_jwt,
)
from src.config import get_settings

logger = structlog.get_logger()
router = APIRouter(prefix="/auth", tags=["auth"])


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


class CallbackQuery(BaseModel):
    """OAuth callback query parameters."""

    code: str
    state: str


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
    session: str | None = Cookie(default=None),
) -> UserResponse:
    """
    Get current authenticated user.

    Validates session cookie and returns user info with organization name.
    """
    if not session:
        raise HTTPException(401, "Not authenticated")

    token = verify_jwt(session)
    if not token:
        raise HTTPException(401, "Invalid or expired session")

    # Fetch organization name
    from src.auth.pilot_accounts import get_org_by_id

    org = await get_org_by_id(token.org_id)
    org_name = org["name"] if org else "Unknown Organization"

    return UserResponse(
        user_id=token.sub,
        org_id=token.org_id,
        org_name=org_name,
        role=token.role,
        email=token.email,
        exp=token.exp,
    )


@router.post("/logout")
async def logout(response: Response) -> dict:
    """
    Logout current user.

    Clears session cookie.
    """
    _clear_session_cookie(response)

    return {"success": True}


# =============================================================================
# Middleware Helper
# =============================================================================


async def require_pilot_auth(session: str | None = Cookie(default=None)) -> PilotToken:
    """
    Dependency that requires valid pilot authentication.

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
    if not session:
        raise HTTPException(401, "Not authenticated")

    token = verify_jwt(session)
    if not token:
        raise HTTPException(401, "Invalid or expired session")

    return token


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
                "email": None,
                "scopes": ["channels:history", "channels:read", "users:read"],
                "oauth_provider": "slack",
            }

        # Microsoft-based providers (Outlook, Teams)
        if provider in ("outlook", "teams"):
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
            if userinfo_response.status_code == 200:
                userinfo = userinfo_response.json()
                email = userinfo.get("mail") or userinfo.get("userPrincipalName")

            scope_map = {
                "outlook": ["Mail.Read"],
                "teams": ["ChannelMessage.Read.All", "Chat.Read"],
            }

            return {
                "access_token": tokens.get("access_token"),
                "refresh_token": tokens.get("refresh_token"),
                "email": email,
                "scopes": scope_map.get(provider, []),
                "oauth_provider": "microsoft",
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
                "email": email,
                "scopes": ["read_content"],
                "oauth_provider": "notion",
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

    if not org_id:
        logger.warning("Connector OAuth missing org_id", state=state[:8])
        return RedirectResponse(url="/?error=missing_org_id", status_code=302)

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
                url="/?error=connector_token_exchange_failed",
                status_code=302,
            )

        access_token = token_result["access_token"]
        refresh_token = token_result.get("refresh_token")
        email = token_result.get("email")
        scopes = token_result.get("scopes", [])
        oauth_provider = token_result.get("oauth_provider", provider)

        # Store connection in database
        from src.db.client import get_db_session
        from cryptography.fernet import Fernet

        # Encrypt tokens (use a simple key derivation for now)
        # In production, use proper key management
        encryption_key = settings.api_key_salt or "default-key-change-me"
        # Pad or truncate to 32 bytes for Fernet
        key_bytes = encryption_key.encode()[:32].ljust(32, b"0")
        from base64 import urlsafe_b64encode as b64encode
        fernet_key = b64encode(key_bytes)
        fernet = Fernet(fernet_key)

        access_token_encrypted = fernet.encrypt(access_token.encode())
        refresh_token_encrypted = fernet.encrypt(refresh_token.encode()) if refresh_token else None

        connection_id = str(uuid4())
        oauth_token_id = str(uuid4())

        # Build connection name
        if email:
            connection_name = f"{provider.replace('_', ' ').title()} - {email}"
        else:
            connection_name = provider.replace("_", " ").title()

        async with get_db_session() as session:
            # Create connection record
            await session.execute(
                text("""
                    INSERT INTO connections (
                        id, organization_id, connector_type, name, config,
                        status, sync_enabled, created_at, updated_at
                    ) VALUES (
                        :id, :org_id, :connector_type, :name, :config,
                        'active', true, NOW(), NOW()
                    )
                """),
                {
                    "id": connection_id,
                    "org_id": org_id,
                    "connector_type": provider,
                    "name": connection_name,
                    "config": json.dumps({
                        "email": email,
                        "restricted_labels": restricted_labels,
                        "restricted_channels": restricted_channels,
                        "scopes": scopes,
                    }),
                },
            )

            # Create oauth_tokens record
            await session.execute(
                text("""
                    INSERT INTO oauth_tokens (
                        id, connection_id, organization_id, provider,
                        access_token_encrypted, refresh_token_encrypted,
                        token_type, scopes, created_at, updated_at
                    ) VALUES (
                        :id, :connection_id, :org_id, :provider,
                        :access_token, :refresh_token,
                        'Bearer', :scopes, NOW(), NOW()
                    )
                """),
                {
                    "id": oauth_token_id,
                    "connection_id": connection_id,
                    "org_id": org_id,
                    "provider": oauth_provider,
                    "access_token": access_token_encrypted,
                    "refresh_token": refresh_token_encrypted,
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

        # Trigger initial sync in the background
        try:
            from src.connectors.scheduling.scheduler import get_scheduler

            scheduler = get_scheduler()
            sync_job = await scheduler.trigger_sync_by_id(
                connection_id=connection_id,
                organization_id=org_id,
                full_refresh=True,  # Initial sync should be a full refresh
            )
            logger.info(
                "Initial sync triggered",
                connection_id=connection_id,
                job_id=sync_job.job_id,
            )
        except Exception as sync_error:
            # Don't fail the OAuth flow if sync fails to start
            # The user can manually trigger sync later
            logger.warning(
                "Failed to trigger initial sync",
                connection_id=connection_id,
                error=str(sync_error),
            )

        # Redirect to frontend with success
        return RedirectResponse(url="/?connection=success", status_code=302)

    except Exception as e:
        logger.error("Connector OAuth failed", provider=provider, error=str(e))
        return RedirectResponse(url=f"/?error=connector_failed", status_code=302)
