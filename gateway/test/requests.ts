import type { AgentStackFrame, CustomBaseEvent } from "../src/types";
import { RunAgentInput } from "../src/types";

export async function sendChatRequest(req: RunAgentInput, port: number = 3000): Promise<AgentStackFrame | string> {
  const APIurl = `http://localhost:${port}/api/chat`
  const response = await fetch(APIurl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Response body is null');
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk);
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      try {
        const jsonEvent: CustomBaseEvent = JSON.parse(data);
        if (jsonEvent.type === 'RUN_FINISHED') {
          return jsonEvent.result as AgentStackFrame;
        } else if (jsonEvent.type === 'RUN_ERROR') {
          return jsonEvent.message as string;
        }
      } catch (e) {
        console.log('failed to parse:', data);
      }
    }
  }
  return "stream ended without completion"
}


