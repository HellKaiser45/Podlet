import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Optional, Any
from dotenv import load_dotenv
from pydantic import BaseModel
import litellm
from litellm import acompletion, CustomStreamWrapper
from litellm.types.utils import ModelResponseStream
from openai.types.chat import ChatCompletionFunctionTool
from litellm.caching.caching import Cache
from litellm.types.caching import LiteLLMCacheType

# ---------------------------------------------------------------------------
# Global cache -- local in-memory. Replace with Redis for multi-process /
# production deployments (adds persistence and shared state across workers).
# ---------------------------------------------------------------------------
litellm.cache = Cache(type=LiteLLMCacheType.LOCAL, ttl=600)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class LLMConfig(BaseModel):
    provider: str
    model: str
    configpath: str
    base_url: Optional[str] = None
    temperature: Optional[float] = None
    api_key_name: Optional[str] = None
    max_tokens: Optional[int] = None


class AgentRequest(BaseModel):
    system_prompt: str
    history: list[dict]
    tools: Optional[list[ChatCompletionFunctionTool]] = None
    response_format: Optional[dict] = None
    config: LLMConfig


# ---------------------------------------------------------------------------
# AgentConstructor
# ---------------------------------------------------------------------------
class AgentConstructor:
    """Orchestrates streaming LLM calls with multi-turn caching.

    On instantiation a stable *conversation id* is derived from the first
    non-system message so the same conversation is always grouped together
    in logs and cache namespaces.
    """

    def __init__(self, parameters: AgentRequest):
        self.parameters = parameters
        self._conversation_id = self._compute_conversation_id()
        self._setup_environment()

    # ---- helpers -----------------------------------------------------------
    def _setup_environment(self) -> None:
        load_dotenv(Path(self.parameters.config.configpath) / ".env")

    def _compute_conversation_id(self) -> str:
        """Stable 16-char hex id derived from the first non-system message.

        Remains constant across every turn within the same conversation.
        Falls back to ``"default"`` when the history is empty.
        """
        first_non_system = next(
            (msg for msg in self.parameters.history if msg.get("role") != "system"),
            None,
        )
        if first_non_system is None:
            return "default"
        content = first_non_system.get("content", "")
        if isinstance(content, list):
            # Flatten list-based content (e.g. OpenAI multimodal blocks)
            content = json.dumps(content, sort_keys=True, default=str)
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    def _build_cache_key(self, messages: list[dict]) -> str:
        """Composite cache key: conversation id + message-content fingerprint.

        The conversation id keeps keys namespaced by conversation; the
        fingerprint ensures each *turn* gets its own cache slot (different
        messages = different key = no stale response returned).

        NOTE: this is passed to litellm as ``cache_key``, NOT
        ``preset_cache_key``. ``preset_cache_key`` is an internal litellm
        bookkeeping kwarg (used to avoid re-hashing between the pre-call
        cache lookup and the post-call cache write); passing it ourselves
        collides with litellm's own internal use of that name and raises
        ``got multiple values for keyword argument 'preset_cache_key'``.
        ``cache_key`` is the supported override -- litellm uses it as-is,
        with no hashing and no internal collision risk.
        """
        fingerprint = hashlib.sha256(
            json.dumps(messages, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()[:16]
        return f"{self._conversation_id}:{fingerprint}"

    def _build_cache_control_injection_points(self, messages: list[dict]) -> list[dict]:
        """Return injection points for provider-level prompt caching.

        Strategy (stays within Anthropic's 4-breakpoint limit):
          - System message: always cached (rarely changes).
          - First user message (index 1 after system): anchor that repeats
            every turn.
          - Last message: creates a checkpoint the next turn can resume from.

        Providers that don't support cache_control silently drop the
        annotation thanks to ``drop_params=True``.
        """
        points: list[dict] = [
            {"location": "message", "role": "system"},
            {"location": "message", "index": -1},
        ]
        # Add first user message as an extra anchor if the conversation is
        # long enough to benefit (index 1 = first message after system).
        if len(messages) > 2:
            points.append({"location": "message", "index": 1})
        return points

    # ---- main entry point --------------------------------------------------
    async def run_streaming(
        self, history: list[dict]
    ) -> AsyncGenerator[ModelResponseStream, None]:
        messages = list(history)

        # Ensure a system message is present
        if not any(msg.get("role") == "system" for msg in messages):
            messages.insert(
                0, {"role": "system", "content": self.parameters.system_prompt}
            )

        cfg = self.parameters.config

        # Build kwargs -------------------------------------------------------
        completion_kwargs: dict[str, Any] = {
            "model": f"{cfg.provider}/{cfg.model}",
            "messages": messages,
            "stream": True,
            # Provider-agnostic safety
            "drop_params": True,
            # LiteLLM response-cache layer
            "caching": True,
            "cache_key": self._build_cache_key(messages),
            # Provider-level prompt-cache annotations (Anthropic / OpenAI)
            "cache_control_injection_points": (
                self._build_cache_control_injection_points(messages)
            ),
        }

        # Optional extras ----------------------------------------------------
        if self.parameters.tools:
            completion_kwargs["tools"] = self.parameters.tools
        if self.parameters.response_format:
            completion_kwargs["response_format"] = self.parameters.response_format
        if cfg.base_url:
            completion_kwargs["api_base"] = cfg.base_url
        if cfg.temperature is not None:
            completion_kwargs["temperature"] = cfg.temperature
        if cfg.max_tokens is not None:
            completion_kwargs["max_tokens"] = cfg.max_tokens
        if cfg.api_key_name:
            completion_kwargs["api_key"] = os.getenv(cfg.api_key_name, "")

        # Logging ------------------------------------------------------------
        print(
            f"{datetime.now():%Y-%m-%d %H:%M:%S} | "
            f"Stream started: {cfg.provider}/{cfg.model} | "
            f"conv={self._conversation_id} | "
            f"msg_count={len(messages)}"
        )

        try:
            response = await acompletion(**completion_kwargs)
            if not isinstance(response, CustomStreamWrapper):
                raise TypeError(
                    f"Expected CustomStreamWrapper, got {type(response).__name__}"
                )
            async for chunk in response:
                yield chunk
        except Exception as e:
            print(f"Stream error [{cfg.provider}/{cfg.model}]: {type(e).__name__}: {e}")
            raise
        finally:
            print(
                f"{datetime.now():%Y-%m-%d %H:%M:%S} | "
                f"Stream closed | conv={self._conversation_id}"
            )
