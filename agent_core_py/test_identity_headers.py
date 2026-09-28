"""Dependency-free tests for ``identity_headers.build_identity_headers``.

Run directly (no pytest needed)::

    python3 test_identity_headers.py

Exits non-zero on the first failure summary (all checks always run).
Not copied into the Docker image (the Dockerfile lists files explicitly).
"""

import os
import sys

from identity_headers import (
    DEFAULT_USER_AGENT,
    OPENROUTER_DEFAULT_REFERER,
    OPENROUTER_DEFAULT_TITLE,
    build_identity_headers,
)

_FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        _FAILURES.append(name)


def with_env(overrides: dict, fn) -> None:
    """Run fn with temporarily set env vars, restoring everything after."""
    saved = {}
    try:
        for key, value in overrides.items():
            saved[key] = os.environ.get(key)
            os.environ[key] = value
        fn()
    finally:
        for key, old in saved.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old


def test_user_agent_precedence() -> None:
    print("User-Agent precedence")

    def default_ua():
        h = build_identity_headers(provider="openai", session_id="s1")
        check(
            "default UA when nothing provided",
            h["User-Agent"] == DEFAULT_USER_AGENT,
            f"got {h['User-Agent']!r}",
        )

    def request_ua():
        h = build_identity_headers(
            provider="openai", session_id="s1", user_agent="podlet/9.9.9"
        )
        check(
            "request UA used when provided",
            h["User-Agent"] == "podlet/9.9.9",
            f"got {h['User-Agent']!r}",
        )

    def env_overrides_request():
        h = build_identity_headers(
            provider="openai", session_id="s1", user_agent="podlet/9.9.9"
        )
        check(
            "env PODLET_USER_AGENT overrides request UA",
            h["User-Agent"] == "my-agent/1.2.3",
            f"got {h['User-Agent']!r}",
        )

    def blank_env_ignored():
        h = build_identity_headers(
            provider="openai", session_id="s1", user_agent="podlet/9.9.9"
        )
        check(
            "blank env PODLET_USER_AGENT falls through to request UA",
            h["User-Agent"] == "podlet/9.9.9",
            f"got {h['User-Agent']!r}",
        )

    default_ua()
    request_ua()
    with_env({"PODLET_USER_AGENT": "my-agent/1.2.3"}, env_overrides_request)
    with_env({"PODLET_USER_AGENT": "   "}, blank_env_ignored)


def test_session_header_always_sent() -> None:
    print("x-opencode-session is always sent")
    for provider in ("openai", "anthropic", "zai", "openrouter"):
        h = build_identity_headers(provider=provider, session_id="thread-123")
        check(
            f"present for provider {provider!r}",
            h.get("x-opencode-session") == "thread-123",
            f"got {h.get('x-opencode-session')!r}",
        )


def test_openrouter_attribution() -> None:
    print("OpenRouter attribution headers")

    def defaults():
        # Case-insensitive provider match
        h = build_identity_headers(provider="OpenRouter", session_id="s1")
        check(
            "HTTP-Referer default",
            h.get("HTTP-Referer") == OPENROUTER_DEFAULT_REFERER,
            f"got {h.get('HTTP-Referer')!r}",
        )
        check(
            "X-OpenRouter-Title default",
            h.get("X-OpenRouter-Title") == OPENROUTER_DEFAULT_TITLE,
            f"got {h.get('X-OpenRouter-Title')!r}",
        )
        check(
            "X-Title default",
            h.get("X-Title") == OPENROUTER_DEFAULT_TITLE,
            f"got {h.get('X-Title')!r}",
        )

    def env_overrides():
        h = build_identity_headers(provider="openrouter", session_id="s1")
        check(
            "X-OpenRouter-Title env override",
            h.get("X-OpenRouter-Title") == "My Custom App",
            f"got {h.get('X-OpenRouter-Title')!r}",
        )
        check(
            "X-Title follows env override",
            h.get("X-Title") == "My Custom App",
            f"got {h.get('X-Title')!r}",
        )
        check(
            "HTTP-Referer env override",
            h.get("HTTP-Referer") == "https://example.com",
            f"got {h.get('HTTP-Referer')!r}",
        )

    def absent_for_others():
        h = build_identity_headers(provider="openai", session_id="s1")
        check(
            "no attribution headers for non-openrouter",
            ("HTTP-Referer" not in h and "X-OpenRouter-Title" not in h
             and "X-Title" not in h),
            f"got {sorted(h)}",
        )

    defaults()
    with_env(
        {"OPENROUTER_APP_TITLE": "My Custom App",
         "OPENROUTER_APP_REFERER": "https://example.com"},
        env_overrides,
    )
    absent_for_others()


def test_extra_headers_merge_last() -> None:
    print("Per-model extra_headers merged last")
    h = build_identity_headers(
        provider="openai",
        session_id="s1",
        user_agent="podlet/9.9.9",
        extra_headers={
            "User-Agent": "override/1.0",
            "X-Custom-Thing": "yes",
        },
    )
    check(
        "extra_headers override User-Agent",
        h["User-Agent"] == "override/1.0",
        f"got {h['User-Agent']!r}",
    )
    check("extra_headers add custom keys", h.get("X-Custom-Thing") == "yes")

    empty = build_identity_headers(
        provider="openai", session_id="s1", extra_headers={}
    )
    check("empty extra_headers dict is a no-op", empty.get("User-Agent") is not None)


def main() -> int:
    test_user_agent_precedence()
    test_session_header_always_sent()
    test_openrouter_attribution()
    test_extra_headers_merge_last()

    print()
    if _FAILURES:
        print(f"FAILED: {len(_FAILURES)} check(s): {', '.join(_FAILURES)}")
        return 1
    print("All identity header checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
