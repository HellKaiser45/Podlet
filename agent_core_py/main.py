from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from litellm.types.utils import Message
from openai.types.chat import ChatCompletionFunctionTool
from core import AgentConstructor
from fastapi.responses import StreamingResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AgentRequest(BaseModel):
    provider: str
    system_prompt: str
    model: str
    history: list[Message]
    tools: list[ChatCompletionFunctionTool] | None = None
    response_format: dict | None = None


@app.post("/chat/stream")
async def chat_stream(req: AgentRequest):
    agent = AgentConstructor(
        provider=req.provider,
        system_prompt=req.system_prompt,
        model=req.model,
        tools=req.tools,
    )

    async def event_generator():
        async for chunk in agent.run_streaming(req.history):
            chunk_json = chunk.model_dump_json()
            yield f"data: {chunk_json}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
