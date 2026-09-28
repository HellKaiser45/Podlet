"""Podlet identifies itself to LLM providers with a static User-Agent
``podlet/<version>`` and a per-conversation ``x-opencode-session`` header
(required by OpenCode Go for routing/prompt caching). For openrouter models,
app attribution headers are added automatically.
"""

# keep in sync with apps/gateway/package.json version
PODLET_USER_AGENT = "podlet/1.0.50"
OPENROUTER_TITLE = "Podlet"
OPENROUTER_REFERER = "https://github.com/HellKaiser45/Podlet"


def build_identity_headers(provider: str, session_id: str) -> dict:
    headers = {
        "User-Agent": PODLET_USER_AGENT,
        "x-opencode-session": session_id,
    }
    if (provider or "").lower() == "openrouter":
        headers["HTTP-Referer"] = OPENROUTER_REFERER
        headers["X-OpenRouter-Title"] = OPENROUTER_TITLE
        headers["X-Title"] = OPENROUTER_TITLE  # legacy alias, same value
    return headers
