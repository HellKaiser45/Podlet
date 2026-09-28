"""Dependency-free checks for Podlet outbound identity headers."""

import os

from identity_headers import (
    DEFAULT_OPENROUTER_REFERER,
    DEFAULT_OPENROUTER_TITLE,
    PODLET_USER_AGENT,
    build_identity_headers,
)

def main() -> int:
    plain = build_identity_headers("openai", "thread-123")
    assert plain["User-Agent"] == PODLET_USER_AGENT
    assert "x-opencode-session" not in plain

    opencode = build_identity_headers(
        "openai", "thread-123", "https://opencode.ai/zen/go/v1"
    )
    assert opencode["x-opencode-session"] == "thread-123"

    openrouter = build_identity_headers("openrouter", "thread-123")
    assert openrouter["HTTP-Referer"] == DEFAULT_OPENROUTER_REFERER
    assert openrouter["X-OpenRouter-Title"] == DEFAULT_OPENROUTER_TITLE
    assert openrouter["X-Title"] == DEFAULT_OPENROUTER_TITLE
    assert "x-opencode-session" not in openrouter

    os.environ["OPENROUTER_APP_REFERER"] = "http://localhost:3000"
    os.environ["OPENROUTER_APP_TITLE"] = "Podlet Local"
    try:
        local = build_identity_headers("openrouter", "thread-123")
        assert local["HTTP-Referer"] == "http://localhost:3000"
        assert local["X-OpenRouter-Title"] == "Podlet Local"
    finally:
        os.environ.pop("OPENROUTER_APP_REFERER", None)
        os.environ.pop("OPENROUTER_APP_TITLE", None)

    print("All identity header checks passed.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
