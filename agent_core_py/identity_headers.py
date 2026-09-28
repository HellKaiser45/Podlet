"""Outbound identity headers for coding-agent traffic and OpenRouter attribution."""

import os
from urllib.parse import urlparse

PODLET_USER_AGENT = "podlet/1.0"
DEFAULT_OPENROUTER_TITLE = "Podlet"
DEFAULT_OPENROUTER_REFERER = "https://github.com/HellKaiser45/Podlet"


def _is_opencode_go(provider: str, base_url: str | None) -> bool:
    provider_name = (provider or "").strip().lower()
    if provider_name in {"opencode", "opencode-go"}:
        return True

    if not base_url:
        return False

    try:
        parsed = urlparse(base_url)
    except ValueError:
        return False

    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/").lower()
    return host == "opencode.ai" and path.startswith("/zen/go/v1")


def build_identity_headers(
    provider: str,
    session_id: str,
    base_url: str | None = None,
) -> dict[str, str]:
    user_agent = os.getenv("PODLET_USER_AGENT", PODLET_USER_AGENT).strip()
    headers: dict[str, str] = {
        "User-Agent": user_agent or PODLET_USER_AGENT,
    }

    # OpenCode Go uses this stable per-conversation identifier for routing and
    # prompt caching. Podlet passes the conversation/thread id through the
    # gateway, so every turn in the same conversation reuses it.
    if _is_opencode_go(provider, base_url):
        headers["x-opencode-session"] = session_id

    # OpenRouter attribution is opt-in by provider. The canonical Podlet URL
    # gives self-hosted instances one shared app identity; both values remain
    # overridable for local/private deployments.
    if (provider or "").strip().lower() == "openrouter":
        headers["HTTP-Referer"] = (
            os.getenv("OPENROUTER_APP_REFERER", DEFAULT_OPENROUTER_REFERER).strip()
            or DEFAULT_OPENROUTER_REFERER
        )
        title = (
            os.getenv("OPENROUTER_APP_TITLE", DEFAULT_OPENROUTER_TITLE).strip()
            or DEFAULT_OPENROUTER_TITLE
        )
        headers["X-OpenRouter-Title"] = title
        headers["X-Title"] = title  # backwards-compatible OpenRouter alias

    return headers
