import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEnvFile, parseEnvFile, resetEnvLoaderForTests } from '../src/system/env';
import { resolveModel } from '../src/system/providers';

// Only these variables are mutated, so a stray real one in the shell cannot
// make a test pass or fail by accident. Each is deleted before a test and
// restored afterwards.
const MANAGED_KEYS = [
  'PODLET_TEST_ONLY_KEY',
  'PODLET_TEST_SHELL_KEY',
  'PODLET_TEST_RELOAD_KEY',
  'PODLET_TEST_OVERRIDE_KEY',
  'PODLET_TEST_PARSE_A',
  'PODLET_TEST_PARSE_B',
  'PODLET_TEST_PARSE_C',
  'PODLET_TEST_PARSE_D',
] as const;

let dir: string;
let saved: Record<string, string | undefined>;

async function writeEnv(text: string): Promise<void> {
  await writeFile(join(dir, '.env'), text, 'utf8');
}

beforeEach(async () => {
  resetEnvLoaderForTests();
  saved = {};
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  dir = await mkdtemp(join(tmpdir(), 'podlet-env-'));
});

afterEach(async () => {
  resetEnvLoaderForTests();
  for (const key of MANAGED_KEYS) {
    const previous = saved[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  await rm(dir, { recursive: true, force: true });
});

describe('.env keys reach process.env and model classification', () => {
  test('a key present ONLY in .env makes a model with that api_key_name usable', async () => {
    await writeEnv('PODLET_TEST_ONLY_KEY=sk-from-env-file\n');
    expect(process.env.PODLET_TEST_ONLY_KEY).toBeUndefined();

    const result = await applyEnvFile(dir);
    expect(result.loaded).toEqual(['PODLET_TEST_ONLY_KEY']);
    expect(process.env.PODLET_TEST_ONLY_KEY).toBe('sk-from-env-file');

    const entry = { provider: 'openai', model: 'gpt-4o-mini', api_key_name: 'PODLET_TEST_ONLY_KEY' };
    expect(resolveModel('env-only', entry, {}).health).toEqual({
      status: 'unusable',
      reason: "model 'env-only': no API key — set PODLET_TEST_ONLY_KEY (from api_key_name)",
    });

    const resolved = resolveModel('env-only', entry, process.env);
    expect(resolved.health).toEqual({ status: 'ok' });
    expect(resolved.api_key).toBe('sk-from-env-file');
    expect(resolved.key_var).toBe('PODLET_TEST_ONLY_KEY');
  });

  test('a real environment variable is not overwritten by the file', async () => {
    process.env.PODLET_TEST_SHELL_KEY = 'from-shell';
    await writeEnv('PODLET_TEST_SHELL_KEY=from-file\n');

    const result = await applyEnvFile(dir);

    expect(process.env.PODLET_TEST_SHELL_KEY).toBe('from-shell');
    expect(result.loaded).toEqual([]);
  });
});

describe('parseEnvFile', () => {
  test('handles export, both quote styles, escapes, comments and blank lines', () => {
    const text = [
      '',
      '   ',
      '# a comment',
      '   # an indented comment',
      'export PODLET_TEST_PARSE_A=exported',
      'PODLET_TEST_PARSE_B="a\\tb"',
      "PODLET_TEST_PARSE_C='a b'",
    ].join('\n');

    const { values, warnings } = parseEnvFile(text);

    expect(warnings).toEqual([]);
    expect(values).toEqual({
      PODLET_TEST_PARSE_A: 'exported',
      PODLET_TEST_PARSE_B: 'a\tb',
      PODLET_TEST_PARSE_C: 'a b',
    });
  });

  test('a # inside an unquoted value is part of the value, not a comment', () => {
    // Documented behaviour: no comment stripping at all. `#` only starts a
    // comment when it is the first non-space character of a line.
    const { values, warnings } = parseEnvFile('PODLET_TEST_PARSE_D=v # trailing\n');

    expect(warnings).toEqual([]);
    expect(values.PODLET_TEST_PARSE_D).toBe('v # trailing');
  });

  test('unquoted values are trimmed and \\r is dropped', () => {
    const { values } = parseEnvFile('PODLET_TEST_PARSE_A=  spaced  \r\nPODLET_TEST_PARSE_B=\r\n');

    expect(values.PODLET_TEST_PARSE_A).toBe('spaced');
    expect(values.PODLET_TEST_PARSE_B).toBe('');
  });

  test('the last duplicate wins', () => {
    const { values } = parseEnvFile('PODLET_TEST_PARSE_A=first\nPODLET_TEST_PARSE_A=second\n');

    expect(values.PODLET_TEST_PARSE_A).toBe('second');
  });

  test('a malformed line warns without throwing and the valid keys still load', async () => {
    await writeEnv([
      'PODLET_TEST_PARSE_A=good',
      'NO_EQUALS_HERE',
      '9BAD_KEY=nope',
      'PODLET_TEST_PARSE_B=also-good',
    ].join('\n') + '\n');

    const parsed = parseEnvFile('NO_EQUALS_HERE\n9BAD_KEY=nope\n');
    expect(parsed.warnings).toEqual(["line 1: missing '='", 'line 2: invalid key']);
    expect(parsed.values).toEqual({});

    const result = await applyEnvFile(dir);

    expect(result.warnings).toEqual(["line 2: missing '='", 'line 3: invalid key']);
    expect(result.loaded).toEqual(['PODLET_TEST_PARSE_A', 'PODLET_TEST_PARSE_B']);
    expect(process.env.PODLET_TEST_PARSE_A).toBe('good');
    expect(process.env.PODLET_TEST_PARSE_B).toBe('also-good');
    expect(process.env.NO_EQUALS_HERE).toBeUndefined();
    expect(process.env['9BAD_KEY']).toBeUndefined();
  });
});

describe('applyEnvFile reload semantics', () => {
  test('a missing .env is a silent no-op', async () => {
    const result = await applyEnvFile(join(dir, 'nested-that-does-not-exist'));

    expect(result.loaded).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.path.endsWith('.env')).toBe(true);
  });

  test('a reload picks up an edited value the loader itself wrote', async () => {
    await writeEnv('PODLET_TEST_RELOAD_KEY=first\n');
    expect((await applyEnvFile(dir)).loaded).toEqual(['PODLET_TEST_RELOAD_KEY']);
    expect(process.env.PODLET_TEST_RELOAD_KEY).toBe('first');

    await writeEnv('PODLET_TEST_RELOAD_KEY=second\n');
    const result = await applyEnvFile(dir);

    expect(result.loaded).toEqual(['PODLET_TEST_RELOAD_KEY']);
    expect(process.env.PODLET_TEST_RELOAD_KEY).toBe('second');
  });

  test('a reload does not overwrite a value changed in process.env after the first apply', async () => {
    await writeEnv('PODLET_TEST_OVERRIDE_KEY=from-file\n');
    expect((await applyEnvFile(dir)).loaded).toEqual(['PODLET_TEST_OVERRIDE_KEY']);

    process.env.PODLET_TEST_OVERRIDE_KEY = 'changed-by-hand';
    await writeEnv('PODLET_TEST_OVERRIDE_KEY=from-file-v2\n');
    const result = await applyEnvFile(dir);

    expect(result.loaded).toEqual([]);
    expect(process.env.PODLET_TEST_OVERRIDE_KEY).toBe('changed-by-hand');
  });

  test('a key removed from the file is deleted again, but only while we still own it', async () => {
    await writeEnv('PODLET_TEST_RELOAD_KEY=owned\nPODLET_TEST_OVERRIDE_KEY=owned-too\n');
    expect((await applyEnvFile(dir)).loaded).toEqual(['PODLET_TEST_RELOAD_KEY', 'PODLET_TEST_OVERRIDE_KEY']);

    process.env.PODLET_TEST_OVERRIDE_KEY = 'changed-by-hand';
    await writeEnv('');
    const result = await applyEnvFile(dir);

    expect(result.loaded).toEqual(['PODLET_TEST_RELOAD_KEY']);
    expect(process.env.PODLET_TEST_RELOAD_KEY).toBeUndefined();
    expect(process.env.PODLET_TEST_OVERRIDE_KEY).toBe('changed-by-hand');
  });
});