"""App identity headers for outbound LLM requests.

Podlet identifies itself to LLM providers with a custom ``User-Agent``
(``podlet/<version>``) and a stable ``x-opencode-session`` header per
conversation. The session header is required by OpenCode Go
(https://opencode.ai/zen/go/v1) for routing and prompt caching. OpenRouter
app attribution headers (``X-OpenRouter-Title`` plus its legacy alias
``X-Title``, both set to the same value, and ``HTTP-Referer``) are added
automatically for openrouter models. Per-model custom headers supplied via
``models.json`` are merged last and take highest precedence.
"""

import os
from typing import Optional

DEFAULT_USER_AGENT = "podlet/0.1.0"
OPENROUTER_DEFAULT_TITLE = "Podlet"
OPENROUTER_DEFAULT_REFERER = "https://github.com/HellKaiser45/Podlet"


def build_identity_headers(
    provider: str,
    session_id: str,
    user_agent: Optional[str] = None,
    extra_headers: Optional[dict] = None,
) -> dict:
    env_ua = os.getenv("PODLET_USER_AGENT")
    if env_ua and env_ua.strip():
        ua = env_ua.strip()
    elif user_agent:
        ua = user_agent
    else:
        ua = DEFAULT_USER_AGENT

    headers = {
        "User-Agent": ua,
        "x-opencode-session": session_id,
    }

    if (provider or "").lower() == "openrouter":
        app_title = os.getenv("OPENROUTER_APP_TITLE") or OPENROUTER_DEFAULT_TITLE
        headers["HTTP-Referer"] = (
            os.getenv("OPENROUTER_APP_REFERER") or OPENROUTER_DEFAULT_REFERER
        )
        headers["X-OpenRouter-Title"] = app_title
        headers["X-Title"] = app_title

    if extra_headers:
        headers.update(extra_headers)

    return headers
