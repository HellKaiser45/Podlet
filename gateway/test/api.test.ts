import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { sendChatRequest } from "./requests";
import { rmSync } from "node:fs";
import { randomUUIDv7 } from "bun";
import type { createServer } from "../src/server";
import { join } from "path";

setDefaultTimeout(6000000)

let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  console.log('starting test server ...')
  const module = await import("./server.test");
  server = module.default;
  console.log("🚀 Test server ready");
});

afterAll(async () => {
  server?.stop();
  rmSync(join(import.meta.dir, "saas-slides"), { recursive: true })
  console.log("🛑 Test server stopped");
});

describe("Test Scenarios", () => {
  test("Basic chat with mcps", async () => {
    const result = await sendChatRequest({
      agentId: "architect",
      message:
        "I have a project of making a lightweight notion widgets catalog website but i dont know where to start and which structure i should use. I wonder if it could use my favorite framework: Qwik maybe in combination with Bun or something make sure to pull latest docs",
      runId: randomUUIDv7(),
      threadId: "test-thread-1",
    });
    expect(result).toBeDefined();
    expect(result.status).toBe('completed')
  })
  test("Skill execution test", async () => {
    const result = await sendChatRequest({
      agentId: "ppt-agent",
      message: `Can you create a slide show/ ppt for me about coding architecture for solo devs. framework: Bun / elysia and focus on saas creation the fastest as possible you can create the ppt here: ${import.meta.dir}/saas-slides/ so you may have to create the directory and the final ppt file should be called saas-creation.pptx`,
      runId: randomUUIDv7(),
      threadId: "test-thread-2",
    })
    expect(result).toBeDefined();
    expect(result.status).toBe('completed')
    const checkfile = Bun.file(join(import.meta.dir, "saas-slides", "saas-creation.pptx"))
    expect(await checkfile.exists()).toBe(true)
  }
  )
})
