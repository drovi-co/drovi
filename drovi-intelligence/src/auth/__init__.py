"""
Authentication module for Drovi Intelligence API.

Provides API key authentication with internal service bypass for the Drovi app.
"""

from src.auth.middleware import (
    APIKeyContext,
    get_api_key_context,
    get_optional_api_key_context,
    require_scope,
    require_rate_limit,
    require_scope_with_rate_limit,
    check_rate_limit_for_context,
    is_public_path,
    API_KEY_HEADER,
    INTERNAL_SERVICE_HEADER,
)
from src.auth.scopes import Scope, has_scope, get_default_scopes, get_all_scopes
from src.auth.api_key import (
    generate_api_key,
    hash_api_key,
    validate_api_key,
    create_api_key,
    revoke_api_key,
    list_api_keys,
)
from src.auth.rate_limit import (
    RateLimitResult,
    TokenBucketRateLimiter,
    check_rate_limit,
    get_rate_limiter,
)

__all__ = [
    # Middleware
    "APIKeyContext",
    "get_api_key_context",
    "get_optional_api_key_context",
    "require_scope",
    "require_rate_limit",
    "require_scope_with_rate_limit",
    "check_rate_limit_for_context",
    "is_public_path",
    "API_KEY_HEADER",
    "INTERNAL_SERVICE_HEADER",
    # Scopes
    "Scope",
    "has_scope",
    "get_default_scopes",
    "get_all_scopes",
    # API Keys
    "generate_api_key",
    "hash_api_key",
    "validate_api_key",
    "create_api_key",
    "revoke_api_key",
    "list_api_keys",
    # Rate Limiting
    "RateLimitResult",
    "TokenBucketRateLimiter",
    "check_rate_limit",
    "get_rate_limiter",
]
