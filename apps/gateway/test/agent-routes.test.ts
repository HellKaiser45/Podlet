import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AgentsManager from '../src/system/agents';
import agentsRoutes from '../src/api-routes/agents-routes';
import type AppContainer from '../src/runtime';

let dir: string;
let manager: AgentsManager;
let app: Elysia;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'podlet-agents-routes-'));
  await mkdir(join(dir, 'agents'), { recursive: true });
  await mkdir(join(dir, 'prompts'), { recursive: true });

  manager = new AgentsManager(dir);
  await writeFile(join(dir, 'agents', 'alpha.json'), JSON.stringify({
    agentId: 'alpha',
    agentDescription: 'test agent',
    model: 'fast',
    system_prompt: 'alpha.md',
  }, null, 2));
  await manager.loadAll();

  // Only the two members these routes touch; the rest of the container is
  // irrelevant to the body-schema round-trip under test.
  const container = {
    agentManager: manager,
    eventManager: {},
    usageSink: () => {},
  } as unknown as AppContainer;
  // `container` is a deliberate partial mock (only the two members below), so
  // the plugin's inferred route type cannot line up with a bare `Elysia`; the
  // app is only driven through `.handle()` in this file.
  app = new Elysia().use(agentsRoutes(container)) as unknown as Elysia;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('agent thinking round-trips through the API', () => {
  test('PUT /agents/:agentId persists thinking to the agent file', async () => {
    const res = await app.handle(new Request('http://localhost/agents/alpha', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thinking: 'high' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.thinking).toBe('high');

    const onDisk = await Bun.file(join(dir, 'agents', 'alpha.json')).json();
    expect(onDisk.thinking).toBe('high');
    expect(onDisk.health).toBeUndefined();
  });

  test('POST /agents accepts thinking', async () => {
    const res = await app.handle(new Request('http://localhost/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'beta',
        agentDescription: 'second',
        model: 'smart',
        system_prompt: 'beta.md',
        thinking: 'low',
      }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.thinking).toBe('low');

    expect(manager.agents.beta.thinking).toBe('low');
  });

  test('an unknown thinking literal is rejected, not coerced to none', async () => {
    const res = await app.handle(new Request('http://localhost/agents/alpha', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thinking: 'extreme' }),
    }));
    expect(res.status).toBe(422);

    const onDisk = await Bun.file(join(dir, 'agents', 'alpha.json')).json();
    expect(onDisk.thinking).toBe('high');
  });

  test('GET /agents/all keeps its keyed-object shape', async () => {
    const res = await app.handle(new Request('http://localhost/agents/all'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Five web call sites read Record<string, Agent>; an array would break all of them.
    expect(Array.isArray(body)).toBe(false);
    expect(typeof body).toBe('object');
    expect(Object.keys(body).sort()).toEqual(['alpha', 'beta']);
    expect(body.alpha.agentId).toBe('alpha');
    expect(body.alpha.model).toBe('fast');
    expect(body.alpha.system_prompt).toBe('alpha.md');
    expect(body.beta.thinking).toBe('low');
  });
});