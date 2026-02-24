"""Browser-render fetch worker for JS-heavy pages."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RenderFetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str | None
    html: str
    blocked: bool
    retryable: bool
    error_message: str | None = None


async def fetch_rendered(
    *,
    url: str,
    user_agent: str,
    timeout_ms: int,
) -> RenderFetchResult:
    """
    Render a URL in Playwright and return resulting HTML.

    This worker is optional and only used when static fetch is insufficient
    or when configured source profiles require JS execution.
    """
    try:
        from playwright.async_api import async_playwright
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        return RenderFetchResult(
            url=url,
            final_url=url,
            status_code=0,
            content_type=None,
            html="",
            blocked=False,
            retryable=True,
            error_message=f"Playwright unavailable: {exc}",
        )

    try:
        async with async_playwright() as p:  # pragma: no cover - integration path
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(user_agent=user_agent)
            page = await context.new_page()
            response = await page.goto(url, wait_until="networkidle", timeout=max(1000, int(timeout_ms)))
            html = await page.content()
            final_url = page.url or url
            status_code = int(response.status) if response else 200
            content_type = response.headers.get("content-type") if response else None
            await context.close()
            await browser.close()
    except Exception as exc:  # pragma: no cover - integration path
        return RenderFetchResult(
            url=url,
            final_url=url,
            status_code=0,
            content_type=None,
            html="",
            blocked=False,
            retryable=True,
            error_message=f"render_failed: {exc}",
        )

    blocked = status_code in {401, 403, 406, 429}
    retryable = status_code >= 500 or status_code in {408, 429}
    return RenderFetchResult(
        url=url,
        final_url=final_url,
        status_code=status_code,
        content_type=content_type,
        html=html,
        blocked=blocked,
        retryable=retryable,
        error_message=None if status_code < 400 else f"HTTP {status_code}",
    )
