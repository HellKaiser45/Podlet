import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CANONICAL_FOR,
  KEY_ENV_BY_PROTOCOL,
  PROTOCOLS,
  PROVIDER_TABLE,
  resolveModel,
} from '../src/system/providers';
import ModelsManager from '../src/system/models';

// The shipped config, read from the repo — it must not need an edit (K-11).
const shippedPath = join(import.meta.dir, '..', '..', '..', '.podlet', 'models.json');

const noEnv: Record<string, string | undefined> = {};

describe('PROVIDER_TABLE is a lookup, not a heuristic', () => {
  test('every row resolves to one of the three protocols', () => {
    for (const [name, row] of Object.entries(PROVIDER_TABLE)) {
      expect({ name, ok: PROTOCOLS.includes(row.protocol) }).toEqual({ name, ok: true });
    }
  });

  test('azure / vertex / bedrock have no row', () => {
    expect(PROVIDER_TABLE.azure).toBeUndefined();
    expect(PROVIDER_TABLE.vertex).toBeUndefined();
    expect(PROVIDER_TABLE.bedrock).toBeUndefined();
  });

  test('every CANONICAL_FOR member resolves without a base_url', () => {
    for (const [protocol, providers] of Object.entries(CANONICAL_FOR)) {
      for (const provider of providers) {
        const resolved = resolveModel('m', { provider, model: 'x' }, {
          [KEY_ENV_BY_PROTOCOL[protocol as keyof typeof KEY_ENV_BY_PROTOCOL]]: 'k',
        });
        expect({ provider, status: resolved.health.status, protocol: resolved.protocol })
          .toEqual({ provider, status: 'ok', protocol });
      }
    }
  });

  test('an unknown provider is an error naming the fix, never a default', () => {
    const resolved = resolveModel('m', { provider: 'someothervendorname', model: 'x' }, { OPENAI_API_KEY: 'k' });
    expect(resolved.health.status).toBe('unusable');
    expect(resolved.health.reason).toContain("unknown provider 'someothervendorname'");
    expect(resolved.health.reason).toContain('not in the supported provider table');
    expect(resolved.health.reason).toContain('base_url');
    expect(resolved.health.reason).toContain('api_key_name');
    expect(resolved.health.reason).not.toContain('protocol');
    expect(resolved.protocol).toBeUndefined();
  });
});

describe('shipped .podlet/models.json resolves unchanged', () => {
  let shipped: Record<string, any>;

  beforeAll(async () => {
    shipped = await Bun.file(shippedPath).json();
  });

  test('fast (openrouter) resolves ok with its key injected', () => {
    const resolved = resolveModel('fast', shipped.fast, { OPENROUTER_API_KEY: 'sk-or-test' });
    expect(resolved.health).toEqual({ status: 'ok' });
    expect(resolved.protocol).toBe('openai');
    expect(resolved.base_url).toBe('https://openrouter.ai/api/v1');
    expect(resolved.key_var).toBe('OPENROUTER_API_KEY');
    expect(resolved.api_key).toBe('sk-or-test');
    expect(resolved.headers['HTTP-Referer']).toBe('https://github.com/HellKaiser45/Podlet');
    expect(resolved.headers['X-OpenRouter-Title']).toBe('Podlet');
  });

  test('smart (zai) resolves ok with its key injected', () => {
    const resolved = resolveModel('smart', shipped.smart, { ZAI_API_KEY: 'zai-test' });
    expect(resolved.health).toEqual({ status: 'ok' });
    expect(resolved.protocol).toBe('openai');
    expect(resolved.base_url).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(resolved.key_var).toBe('ZAI_API_KEY');
    expect(resolved.headers).toEqual({});
  });

  test('without keys each seed reports the exact reason string', () => {
    expect(resolveModel('fast', shipped.fast, noEnv).health).toEqual({
      status: 'unusable',
      reason: "model 'fast': no API key — set OPENROUTER_API_KEY (from provider)",
    });
    expect(resolveModel('smart', shipped.smart, noEnv).health).toEqual({
      status: 'unusable',
      reason: "model 'smart': no API key — set ZAI_API_KEY (from provider)",
    });
  });

  test('zai without base_url is unusable, not quietly pointed at OpenAI', () => {
    const resolved = resolveModel('smart', { provider: 'zai', model: 'GLM-5.1' }, { ZAI_API_KEY: 'k' });
    expect(resolved.health.status).toBe('unusable');
    expect(resolved.health.reason).toBe("model 'smart': base_url required for provider 'zai' (protocol 'openai')");
  });

  test('the whole file classifies through ModelsManager without dropping entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'podlet-models-shipped-'));
    try {
      await writeFile(join(dir, 'models.json'), JSON.stringify(shipped, null, 2));
      const manager = new ModelsManager(dir);
      await manager.init();
      expect(manager.fileError).toBeUndefined();
      expect(Object.keys(manager.models).sort()).toEqual(['fast', 'smart']);
      expect(manager.getAll({}).fast.health.status).toBe('unusable');
      expect(manager.getAll({ OPENROUTER_API_KEY: 'a', ZAI_API_KEY: 'b' }).smart.health.status).toBe('ok');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('API key resolution is a terminal step', () => {
  test('an unset api_key_name is an error and does NOT fall through to the provider default', () => {
    // OPENROUTER_API_KEY is available: the old chain would have authenticated
    // as a completely different credential.
    const resolved = resolveModel(
      'm',
      { provider: 'openrouter', model: 'x', api_key_name: 'MY_UNSET_KEY' },
      { OPENROUTER_API_KEY: 'sk-or-test' },
    );
    expect(resolved.health.status).toBe('unusable');
    expect(resolved.health.reason).toBe("model 'm': no API key — set MY_UNSET_KEY (from api_key_name)");
    expect(resolved.api_key).toBeUndefined();
  });

  test('an explicitly named variable is honoured when set', () => {
    const resolved = resolveModel(
      'm',
      { provider: 'openai', model: 'x', api_key_name: 'TEAM_OPENAI_KEY' },
      { TEAM_OPENAI_KEY: 'sk-team', OPENAI_API_KEY: 'sk-personal' },
    );
    expect(resolved.health).toEqual({ status: 'ok' });
    expect(resolved.key_var).toBe('TEAM_OPENAI_KEY');
    expect(resolved.api_key).toBe('sk-team');
  });

  test('an empty string counts as unset', () => {
    const resolved = resolveModel('m', { provider: 'openai', model: 'x' }, { OPENAI_API_KEY: '' });
    expect(resolved.health.status).toBe('unusable');
    expect(resolved.health.reason).toBe("model 'm': no API key — set OPENAI_API_KEY (from provider)");
  });

  test('ollama and lm_studio resolve without a key (api_key_optional decides what a miss means)', () => {
    for (const provider of ['ollama', 'lm_studio']) {
      const resolved = resolveModel('m', { provider, model: 'x' }, noEnv);
      expect({ provider, health: resolved.health }).toEqual({ provider, health: { status: 'ok' } });
      expect(resolved.api_key).toBeUndefined();
      expect(resolved.key_var).toBe(PROVIDER_TABLE[provider].key_env!);
    }
  });

  test('api_key_optional on the entry works for a provider whose row requires a key', () => {
    const resolved = resolveModel('m', { provider: 'zai', model: 'x', base_url: 'https://api.z.ai/api/coding/paas/v4', api_key_optional: true }, noEnv);
    expect(resolved.health).toEqual({ status: 'ok' });
    expect(resolved.api_key).toBeUndefined();
  });
});

describe('entry-level field validation', () => {
  test('a bad base_url is unusable and names the field', () => {
    const resolved = resolveModel('m', { provider: 'zai', model: 'x', base_url: 'not a url' }, { ZAI_API_KEY: 'k' });
    expect(resolved.health.status).toBe('unusable');
    expect(resolved.health.reason).toBe("model 'm': base_url 'not a url' is not a valid http(s) URL");
  });

  test('a stored reasoning_effort makes the model unusable with the fix', () => {
    const resolved = resolveModel('m', { provider: 'openai', model: 'x', reasoning_effort: 'high' }, { OPENAI_API_KEY: 'k' });
    expect(resolved.health.status).toBe('unusable');
    expect(resolved.health.reason).toContain('reasoning_effort is no longer a model setting');
    expect(resolved.health.reason).toContain('agent.thinking');
  });

  test('entry headers override table headers', () => {
    const resolved = resolveModel(
      'm',
      { provider: 'openrouter', model: 'x', headers: { 'X-OpenRouter-Title': 'Mine' } },
      { OPENROUTER_API_KEY: 'k' },
    );
    expect(resolved.headers['X-OpenRouter-Title']).toBe('Mine');
    expect(resolved.headers['HTTP-Referer']).toBe('https://github.com/HellKaiser45/Podlet');
  });
});

describe('ModelsManager health, no-fallback and slow-file-change guard', () => {
  let dir: string;
  let manager: ModelsManager;

  const goodFile = {
    fast: { provider: 'openrouter', model: 'google/gemma-4-31b-it' },
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'podlet-models-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('an unknown provider is kept and reported unusable, not ignored', async () => {
    const unknownDir = await mkdtemp(join(tmpdir(), 'podlet-models-unknown-'));
    try {
      await writeFile(join(unknownDir, 'models.json'), JSON.stringify({
        weird: { provider: 'azure', model: 'gpt-4o' },
      }));
      const m = new ModelsManager(unknownDir);
      await m.init();
      expect(Object.keys(m.models)).toEqual(['weird']);
      expect(m.getAll({ OPENAI_API_KEY: 'k' }).weird.health).toEqual({
        status: 'unusable',
        reason: "model 'weird': unknown provider 'azure'; it is not in the supported provider table — use one of the supported provider names with an entry-level base_url pointing at your own endpoint, or set api_key_name for a non-standard key variable",
      });
    } finally {
      await rm(unknownDir, { recursive: true, force: true });
    }
  });

  test('a malformed file surfaces the parse error and retains nothing', async () => {
    const brokenDir = await mkdtemp(join(tmpdir(), 'podlet-models-broken-'));
    try {
      const path = join(brokenDir, 'models.json');
      await writeFile(path, JSON.stringify(goodFile));
      const m = new ModelsManager(brokenDir);
      await m.init();
      expect(Object.keys(m.models)).toEqual(['fast']);

      await writeFile(path, '{ "fast": { "provider": ');
      const future = new Date(Date.now() + 10_000);
      await utimes(path, future, future);
      await m.init();

      expect(m.models).toEqual({});
      expect(m.getAll({}).fast).toBeUndefined();
      expect(m.fileError).toStartWith('models.json: ');
    } finally {
      await rm(brokenDir, { recursive: true, force: true });
    }
  });

  test('a re-read whose mtime is not newer than the last self-write is skipped', async () => {
    manager = new ModelsManager(dir);
    await writeFile(join(dir, 'models.json'), JSON.stringify(goodFile));
    await manager.init();
    expect(Object.keys(manager.models)).toEqual(['fast']);

    // save() stamps lastSelfWriteAt; the watcher's debounced init() must not
    // re-read that same mtime (a boolean flag would already have been cleared).
    await manager.update('fast', { temperature: 0.5 });
    expect(manager.models.fast.temperature).toBe(0.5);

    await writeFile(join(dir, 'models.json'), JSON.stringify({ tampered: { provider: 'openai', model: 'x' } }));
    const past = new Date(Date.now() - 60_000);
    await utimes(join(dir, 'models.json'), past, past);
    await manager.init();

    expect(Object.keys(manager.models)).toEqual(['fast']);
    expect(manager.models.fast.temperature).toBe(0.5);
  });

  test('a genuinely newer mtime is re-read', async () => {
    const path = join(dir, 'models.json');
    await writeFile(path, JSON.stringify({ fresh: { provider: 'openai', model: 'gpt-4o-mini' } }));
    const future = new Date(Date.now() + 5_000);
    await utimes(path, future, future);

    await manager.init();

    expect(Object.keys(manager.models)).toEqual(['fresh']);
    expect(manager.health.fresh.status).toBe('unusable');
  });

  test('a partial PUT cannot resurrect a stored reasoning_effort', async () => {
    const legacyDir = await mkdtemp(join(tmpdir(), 'podlet-models-legacy-'));
    try {
      const path = join(legacyDir, 'models.json');
      await writeFile(path, JSON.stringify({
        legacy: { provider: 'openai', model: 'gpt-4o-mini', reasoning_effort: 'high' },
      }));
      const m = new ModelsManager(legacyDir);
      await m.init();
      expect(m.health.legacy.status).toBe('unusable');

      await m.update('legacy', { temperature: 0.2 });

      expect(m.models.legacy.reasoning_effort).toBeUndefined();
      const onDisk = await Bun.file(path).json();
      expect(onDisk.legacy.reasoning_effort).toBeUndefined();
      expect(m.getAll({ OPENAI_API_KEY: 'k' }).legacy.health).toEqual({ status: 'ok' });
    } finally {
      await rm(legacyDir, { recursive: true, force: true });
    }
  });
});