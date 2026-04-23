import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

from core import AgentConstructor, AgentRequest, LLMConfig
from openai.types.chat import ChatCompletionFunctionTool

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Flattened request for the API endpoint
class WebChatRequest(BaseModel):
    provider: str
    model: str
    system_prompt: str
    history: List[dict]
    configpath: str = "./config"
    tools: Optional[List[ChatCompletionFunctionTool]] = None
    temperature: Optional[float] = None
    base_url: Optional[str] = None
    api_key_name: Optional[str] = None
    max_tokens: Optional[int] = None
    response_format: Optional[dict] = None


@app.post("/chat/stream")
async def chat_stream(req: WebChatRequest):
    # 1. Map the web request to our internal AgentRequest structure
    llm_config = LLMConfig(
        provider=req.provider,
        model=req.model,
        configpath=req.configpath,
        temperature=req.temperature,
        api_key_name=req.api_key_name,
        max_tokens=req.max_tokens,
        base_url=req.base_url,
    )

    agent_params = AgentRequest(
        system_prompt=req.system_prompt,
        history=req.history,
        tools=req.tools,
        response_format=req.response_format,
        config=llm_config,
    )

    # 2. Initialize the agent
    agent = AgentConstructor(parameters=agent_params)

    async def event_generator():
        try:
            # We pass the history from the request to run_streaming
            async for chunk in agent.run_streaming(req.history):
                # LiteLLM's chunk is a Pydantic model; model_dump_json is standard
                yield f"data: {chunk.model_dump_json()}\n\n"

        except Exception as e:
            # Send the error as a JSON-formatted SSE event so the frontend can parse it
            error_data = json.dumps({"error": str(e), "type": type(e).__name__})
            yield f"data: {error_data}\n\n"
        finally:
            # Standard SSE signal to notify the client the stream is finished
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disables proxy buffering (important for Nginx)
        },
    )
