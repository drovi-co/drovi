"""
Rate Limiting for Drovi Intelligence API.

Provides Redis-based token bucket rate limiting for API keys.
"""

import time
from typing import NamedTuple

import structlog

logger = structlog.get_logger()


class RateLimitResult(NamedTuple):
    """Result of a rate limit check."""

    allowed: bool
    remaining: int
    reset_at: float  # Unix timestamp
    limit: int


class TokenBucketRateLimiter:
    """
    Token bucket rate limiter using Redis.

    Each API key gets a bucket that refills at a fixed rate.
    Requests consume tokens from the bucket.

    If Redis is unavailable, allows requests (fail open).
    """

    def __init__(
        self,
        redis_client=None,
        key_prefix: str = "ratelimit:",
        window_seconds: int = 60,
    ):
        """
        Initialize rate limiter.

        Args:
            redis_client: Optional Redis client. If None, uses get_redis().
            key_prefix: Prefix for Redis keys
            window_seconds: Time window for rate limit (default 60 = per minute)
        """
        self._redis = redis_client
        self.key_prefix = key_prefix
        self.window_seconds = window_seconds

    async def _get_redis(self):
        """Get or create Redis connection."""
        if self._redis is None:
            try:
                from src.db.redis import get_redis
                self._redis = await get_redis()
            except Exception as e:
                logger.warning("Redis unavailable for rate limiting", error=str(e))
                return None
        return self._redis

    async def check(
        self,
        key_id: str,
        limit: int,
        cost: int = 1,
    ) -> RateLimitResult:
        """
        Check if a request is allowed under rate limit.

        Uses sliding window counter with Redis.

        Args:
            key_id: Unique identifier for the rate limit bucket (e.g., API key ID)
            limit: Maximum requests allowed per window
            cost: Number of tokens this request costs (default 1)

        Returns:
            RateLimitResult with allowed status and remaining tokens
        """
        redis = await self._get_redis()

        if redis is None:
            # Fail open - allow request if Redis unavailable
            logger.debug("Rate limit check skipped - Redis unavailable")
            return RateLimitResult(
                allowed=True,
                remaining=limit,
                reset_at=time.time() + self.window_seconds,
                limit=limit,
            )

        try:
            bucket_key = f"{self.key_prefix}{key_id}"
            now = time.time()
            window_start = now - self.window_seconds

            # Use Redis pipeline for atomic operation
            async with redis.pipeline(transaction=True) as pipe:
                # Remove old entries outside the window
                pipe.zremrangebyscore(bucket_key, 0, window_start)
                # Count current entries in window
                pipe.zcard(bucket_key)
                # Add current request (score = timestamp, member = unique ID)
                request_id = f"{now}:{cost}"
                pipe.zadd(bucket_key, {request_id: now})
                # Set expiry on the bucket
                pipe.expire(bucket_key, self.window_seconds * 2)

                results = await pipe.execute()

            current_count = results[1]  # zcard result

            # Check if under limit
            allowed = current_count < limit
            remaining = max(0, limit - current_count - cost)

            if not allowed:
                # Remove the request we just added since it's denied
                await redis.zrem(bucket_key, request_id)
                remaining = 0

            reset_at = now + self.window_seconds

            return RateLimitResult(
                allowed=allowed,
                remaining=remaining,
                reset_at=reset_at,
                limit=limit,
            )

        except Exception as e:
            logger.error("Rate limit check failed", error=str(e))
            # Fail open
            return RateLimitResult(
                allowed=True,
                remaining=limit,
                reset_at=time.time() + self.window_seconds,
                limit=limit,
            )

    async def get_usage(self, key_id: str) -> dict:
        """
        Get current rate limit usage for a key.

        Args:
            key_id: The API key ID

        Returns:
            Dict with current usage statistics
        """
        redis = await self._get_redis()

        if redis is None:
            return {"count": 0, "window_seconds": self.window_seconds}

        try:
            bucket_key = f"{self.key_prefix}{key_id}"
            now = time.time()
            window_start = now - self.window_seconds

            # Count requests in current window
            count = await redis.zcount(bucket_key, window_start, now)

            return {
                "count": count,
                "window_seconds": self.window_seconds,
                "window_start": window_start,
                "window_end": now,
            }

        except Exception as e:
            logger.error("Failed to get rate limit usage", error=str(e))
            return {"count": 0, "window_seconds": self.window_seconds, "error": str(e)}

    async def reset(self, key_id: str) -> bool:
        """
        Reset rate limit for a key (admin function).

        Args:
            key_id: The API key ID

        Returns:
            True if reset, False otherwise
        """
        redis = await self._get_redis()

        if redis is None:
            return False

        try:
            bucket_key = f"{self.key_prefix}{key_id}"
            await redis.delete(bucket_key)
            logger.info("Rate limit reset", key_id=key_id)
            return True
        except Exception as e:
            logger.error("Failed to reset rate limit", error=str(e))
            return False


# Global rate limiter instance
_rate_limiter: TokenBucketRateLimiter | None = None


async def get_rate_limiter() -> TokenBucketRateLimiter:
    """Get or create the global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = TokenBucketRateLimiter()
    return _rate_limiter


async def check_rate_limit(key_id: str, limit: int) -> RateLimitResult:
    """
    Check rate limit for an API key.

    Convenience function using the global rate limiter.

    Args:
        key_id: API key ID
        limit: Requests per minute limit

    Returns:
        RateLimitResult
    """
    limiter = await get_rate_limiter()
    return await limiter.check(key_id, limit)
