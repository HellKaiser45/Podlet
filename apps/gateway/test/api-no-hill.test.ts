import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { sendChatRequest } from "./requests";
import { rmSync } from "node:fs";
import { randomUUIDv7 } from "bun";
import type { createServer } from "../src/server";
import { join } from "path";
import { runServer, testConfig } from "./server.test";
import { existsSync, statSync } from "node:fs";

let server: ReturnType<typeof createServer>;

function folderExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

beforeAll(async () => {
  server = await runServer(testConfig)
});

afterAll(async () => {
  server?.stop();
  rmSync(join(import.meta.dir, "saas-slides"), { recursive: true, force: true })
});

describe("Test Scenarios", () => {
  test("Basic chat with mcps", async () => {
    const result = await sendChatRequest({
      forwardedProps: { agentId: "architect" },
      message: {
        role: "user",
        content: "I have a project of making a lightweight notion widgets catalog website but i dont know where to start and which structure i should use. I wonder if it could use my favorite framework: Qwik maybe in combination with Bun or something make sure to pull latest docs",
      },
      runId: randomUUIDv7(),
      threadId: "test-thread-1",
      tools: [],
      context: [],
    }, testConfig.appPort)
    expect(result).toBeDefined();
    if (typeof result === 'string') {
      throw new Error(`Expected an AgentStackFrame but got a string: ${result}`);
    }
    expect(result.status).toBe('completed')
  }, 3 * 60 * 1000)

  //   test("Skill execution test without hil", async () => {
  //     const result = await sendChatRequest({
  //       forwardedProps: { agentId: "ppt-agent" },
  //       message: {
  //         role: "user",
  //         content: `Can you create a slide show/ppt for me about creating a saas for solo devs.
  //    framework: Bun / elysia / Qwik (which ever seems best and could be a combination)
  //    and focus on saas creation as fast as possible. 
  //    You must create the ppt here: ${import.meta.dir}/saas-slides/ so you may have to create the directory and the final ppt file should be called saas-creation.pptx
  //    But first you need to make the necessary research and compile a good slide architecture and all the slides must be well designed`,
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
  //
  //   test("Hill approval test", async () => {
  //     const result = await sendChatRequest({
  //       forwardedProps: { agentId: "architect-sub" },
  //       message: {
  //         role: "user",
  //         content: `Can you create a slide show/ppt for me about creating a saas for solo devs.
  //    framework: Bun / elysia / Qwik (which ever seems best and could be a combination)
  //    and focus on saas creation as fast as possible. 
  //    You must create the ppt here: ${import.meta.dir}/saas-slides/ so you may have to create the directory and the final ppt file should be called saas-creation.pptx
  //    But first you need to make the necessary research and compile a good slide architecture and all the slides must be well designed`,
  //       },
  //       runId: randomUUIDv7(),
  //       threadId: "test-thread-3",
  //       tools: [],
  //       context: [],
  //     }, testConfig.appPort)
  //
  //     expect(result).toBeDefined();
  //     if (typeof result === 'string') {
  //       throw new Error(`Expected an AgentStackFrame but got a string: ${result}`);
  //     }
  //     expect(result.status).toBe('completed')
  //     const checkfile = Bun.file(join(import.meta.dir, "saas-slides", "saas-creation.pptx"))
  //     expect(await checkfile.exists()).toBe(true)
  //     rmSync(join(import.meta.dir, "saas-slides"), { recursive: true })
  //   }, 12 * 60 * 1000)
  //
  //   test("complex nested sub agents", async () => {
  //     const result = await sendChatRequest({
  //       forwardedProps: { agentId: "elysia-architect" },
  //       message: {
  //         role: "user",
  //         content: `Create a complete, production-ready Elysia.js Todo List APP REST API and frontend
  // using Bun + TypeScript at ${import.meta.dir}/todo-app/.
  //
  // The project must include all source files, configuration files,
  // middleware, typed models, a test file, and a README.
  //
  // When finished, output a machine-readable JSON manifest listing
  // every created file path and its purpose — suitable for use as
  // expected output in an API unit test.`,
  //       },
  //       runId: randomUUIDv7(),
  //       threadId: `test-thread-parallel-${randomUUIDv7()}`,
  //       tools: [],
  //       context: [],
  //     });
  //     expect(result).toBeDefined();
  //     if (typeof result === 'string') {
  //       throw new Error(`Expected an AgentStackFrame but got a string: ${result}`);
  //     }
  //     expect(result.status).toBe('completed')
  //     const folderPath = join(import.meta.dir, "todo-app")
  //     expect(folderExists(folderPath)).toBe(true)
  //     rmSync(folderPath, { recursive: true })
  //   }, 30 * 60 * 1000)
})
