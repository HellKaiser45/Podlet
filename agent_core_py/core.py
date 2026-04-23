from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Optional, Any
from dotenv import load_dotenv
from pydantic import BaseModel
from litellm import acompletion, CustomStreamWrapper
from litellm.types.utils import ModelResponseStream
from openai.types.chat import ChatCompletionFunctionTool


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


class AgentConstructor:
    def __init__(self, parameters: AgentRequest):
        self.parameters = parameters
        self._setup_environment()

    def _setup_environment(self):
        load_dotenv(Path(self.parameters.config.configpath) / ".env")

    async def run_streaming(
        self, history: list[dict]
    ) -> AsyncGenerator[ModelResponseStream, None]:
        messages = list(history)
        if not any(msg.get("role") == "system" for msg in messages):
            messages.insert(
                0, {"role": "system", "content": self.parameters.system_prompt}
            )

        cfg = self.parameters.config
        completion_kwargs: dict[str, Any] = {
            "model": f"{cfg.provider}/{cfg.model}",
            "messages": messages,
            "stream": True,
            "drop_params": True,
        }

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
            import os

            completion_kwargs["api_key"] = os.getenv(cfg.api_key_name, "")

        print(
            f"{datetime.now():%Y-%m-%d %H:%M:%S} | Stream started: {cfg.provider}/{cfg.model}"
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
            print(f"{datetime.now():%Y-%m-%d %H:%M:%S} | Stream closed")
