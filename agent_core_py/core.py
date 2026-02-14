from dotenv import load_dotenv
from litellm import StreamingChoices, acompletion, CustomStreamWrapper, Message
from dataclasses import dataclass
from litellm.types.utils import Delta, ModelResponseStream
from openai.types.chat import ChatCompletionFunctionTool
from typing import AsyncGenerator
import asyncio

load_dotenv()


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


async def main():
    agent = AgentConstructor(
        provider="moonshot",
        model="kimi-k2.5",
        system_prompt="You are a helpful assistant.",
    )

    history = [Message(role="user", content="Think step by step: What is 123 * 456?")]

    print(f"--- Streaming from {agent.provider}/{agent.model} ---\n")

    try:
        async for choice in agent.run_streaming(history):
            print(choice, end="\n\n", flush=True)

    except Exception as e:
        print(f"\nError: {e}")

    print("\n--- Stream Finished ---")


if __name__ == "__main__":
    asyncio.run(main())
