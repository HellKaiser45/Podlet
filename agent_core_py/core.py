from dotenv import load_dotenv
from pathlib import Path
from litellm import acompletion, CustomStreamWrapper, Message
from dataclasses import dataclass
from litellm.types.utils import ModelResponseStream
from openai.types.chat import ChatCompletionFunctionTool
from typing import AsyncGenerator

dotenv_path = Path.home() / ".podelet" / ".env"
load_dotenv(dotenv_path)


@dataclass
class AgentConstructor:
    provider: str
    system_prompt: str
    model: str
    tools: list[ChatCompletionFunctionTool] | None = None
    response_format: dict[str, str] | None = None

    async def run_streaming(
        self, history: list[Message]
    ) -> AsyncGenerator[ModelResponseStream, None]:
        dicts = [message.model_dump() for message in history]
        if not any(msg.get("role") == "system" for msg in dicts):
            dicts.insert(0, {"role": "system", "content": self.system_prompt})

        print("stream started")
        try:
            response = await acompletion(
                model=f"{self.provider}/{self.model}",
                messages=dicts,
                tools=self.tools,
                stream=True,
            )
            assert isinstance(response, CustomStreamWrapper)

            async for chunk in response:
                if chunk:
                    yield chunk
        except Exception as e:
            print(f"Steam error: {e}")
            raise e
        finally:
            print("Stream closed (cleanup run)")
