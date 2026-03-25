import type { AgentStackFrame } from "../src/types";
import { RunAgentInput } from "../src/types";




export async function sendChatRequest(req: RunAgentInput, APIurl: string = "http://localhost:3000/api/chat"): Promise<AgentStackFrame> {
  console.log(`\n📤 Sending request:`, JSON.stringify(req, null, 2));

  const response = await fetch(APIurl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = (await response.json()) as AgentStackFrame;
  return result;
}



// describe("Chat API - Agent Stack", () => {
//
//
//   test("Resume with Approval (Automated)", async () => {
//     const runId = randomUUIDv7();
//     let currentFrame = await sendChatRequest({
//       agentId: "architect",
//       message:
//         "I want you to create a file at /home/hellkaiser/.podlet/prompts/ the file will be called BUN_Runtime_expert.md...",
//       runId,
//       threadId: "test-thread-2",
//     });
//
//     // Auto-approve loop until no more pending approvals
//     while (
//       currentFrame.status === "suspended" &&
//       currentFrame.pending_approvals?.length > 0
//     ) {
//       console.log(
//         `\n⏸️ Found ${currentFrame.pending_approvals.length} pending approvals`,
//       );
//
//       const decision: Record<string, { approved: boolean }> = {};
//
//       for (const approval of currentFrame.pending_approvals) {
//         console.log(` ✅ Auto-approving: ${approval.tool_call.function.name}`);
//         decision[approval.tool_call.id] = { approved: true };
//       }
//
//       currentFrame = await sendChatRequest({
//         agentId: "architect",
//         message: "",
//         runId,
//         threadId: "test-thread-2",
//         decision,
//       });
//     }
//
//     expect(currentFrame.status).toBe("completed"); // or whatever final status you expect
//     expect(currentFrame.history).toBeArray();
//     console.log(
//       `✅ Execution completed with status: ${currentFrame.status}`,
//       `📝 Final history length: ${currentFrame.history.length}`,
//     );
//   });
//
//   test("Resume with Rejection", async () => {
//     const runId = randomUUIDv7();
//
//     // Initial request that triggers a dangerous approval
//     await sendChatRequest({
//       agentId: "researcher",
//       message: "Execute dangerous command",
//       runId,
//     });
//
//     const resumeResult = await sendChatRequest({
//       agentId: "researcher",
//       message: "",
//       runId,
//       decision: {
//         dangerous_call: {
//           approved: false,
//           feedback: "Rejected for security reasons",
//         },
//       },
//     });
//
//     expect(resumeResult).toBeDefined();
//     // Add assertions based on your rejection flow, e.g.:
//     // expect(resumeResult.status).toBe("completed");
//     // expect(resumeResult.history.some(h => h.includes("rejected"))).toBe(true);
//   });
//
//   test("Nested Agents", async () => {
//     const result = await sendChatRequest({
//       agentId: "coordinator",
//       message: "Research AI trends and write a summary",
//       runId: crypto.randomUUID(),
//       threadId: "test-thread-3",
//     });
//
//     expect(result).toBeDefined();
//     expect(result.status).toBeOneOf(["completed", "suspended"]);
//   });
// });
