// import { describe, test, expect, beforeAll, afterAll } from "bun:test"
// import { sendChatRequest } from "./requests";
// import { rmSync } from "node:fs";
// import { randomUUIDv7 } from "bun";
// import type { createServer } from "../src/server";
// import { join } from "path";
// import { runServer, testConfigHill } from "./server.test";
//
// let server: ReturnType<typeof createServer>;
//
// beforeAll(async () => {
//   server = await runServer(testConfigHill)
// });
//
// afterAll(async () => {
//   server?.stop();
//   rmSync(join(import.meta.dir, "saas-slides"), { recursive: true, force: true })
// });
//
// describe("Test Scenarios", () => {
//   test("Basic chat with mcps", async () => {
//     const result = await sendChatRequest({
//       forwardedProps: { agentId: "architect" },
//       message: {
//         role: "user",
//         content: `I have a project of making a lightweight notion widgets catalog website but i dont know where to start
// and which structure i should use. I wonder what stack and tech I could and should use as a solo dev`,
//       },
//       runId: randomUUIDv7(),
//       threadId: "test-thread-1",
//       tools: [],
//       context: [],
//     }, testConfigHill.appPort)
//     expect(result).toBeDefined();
//     if (typeof result === 'string') {
//       throw new Error(`Expected an AgentStackFrame but got a string: ${result}`);
//     }
//     expect(result.status).toBe('completed')
//   }, 3 * 60 * 1000)
//
//   test("Skill execution test without hil", async () => {
//     const result = await sendChatRequest({
//       forwardedProps: { agentId: "ppt-agent" },
//       message: {
//         role: "user",
//         content: `Can you create a slide show/ ppt for me about coding architecture for solo devs.
// framework: Bun / elysia and focus on saas creation the fastest as possible you can create the ppt here: ${import.meta.dir}/saas-slides/
// so you may have to create the directory and the final ppt file should be called saas-creation.pptx`,
//       },
//       runId: randomUUIDv7(),
//       threadId: "test-thread-2",
//       tools: [],
//       context: [],
//     })
//     expect(result).toBeDefined();
//     if (typeof result === 'string') {
//       throw new Error(`Expected an AgentStackFrame but got a string: ${result}`);
//     }
//     const checkfile = Bun.file(join(import.meta.dir, "saas-slides", "saas-creation.pptx"))
//     expect(await checkfile.exists()).toBe(true)
//     rmSync(join(import.meta.dir, "saas-slides"), { recursive: true })
//   }, { repeats: 3, timeout: 10 * 60 * 1000 })
//
//   test("Parallel execution test", async () => {
//     const requests = Array.from({ length: 5 }, () => sendChatRequest({
//       forwardedProps: { agentId: "architect" },
//       message: {
//         role: "user",
//         content: `I have a project of making a lightweight notion widgets catalog website but i dont know where to start
// and which structure i should use. I wonder what stack and tech I could and should use as a solo dev`,
//       },
//       runId: randomUUIDv7(),
//       threadId: `test-thread-parallel-${randomUUIDv7()}`,
//       tools: [],
//       context: [],
//     }));
//
//     const results = await Promise.all(requests);
//
//     for (const result of results) {
//       expect(result).toBeDefined();
//       if (typeof result === 'string') {
//         throw new Error(`Expected an AgentStackFrame but got a string: ${result}`);
//       }
//       expect(result.status).toBe('completed');
//     }
//   }, 5 * 60 * 1000)
//
//
//   test("Hill approval test", async () => {
//
//   })
// })
