import { describe, expect, test } from 'bun:test';
import { createWarningLogger, namesRequestedCapability } from '../src/llm/warnings';

// ---------------------------------------------------------------------------
// Warning dedupe. `runLlmStream` runs once per tool-loop iteration, so a
// provider compatibility warning would otherwise print on every iteration of
// every turn. Dedupe is logging-only — the unsupported-capability throw in
// `runLlmStream` is deliberately not routed through the logger.
// ---------------------------------------------------------------------------

function collector() {
  const lines: string[] = [];
  const logger = createWarningLogger((line) => lines.push(line));
  return { lines, logger };
}

const propertyNames = {
  type: 'compatibility',
  feature: 'JSON Schema propertyNames',
  details: 'OpenAI does not support JSON Schema propertyNames.',
};

describe('createWarningLogger dedupes identical warnings', () => {
  test('two identical warnings in the same scope log once', () => {
    const { lines, logger } = collector();

    logger.log(propertyNames, 'openai deepseek-v4.1-flash-1017');
    logger.log(propertyNames, 'openai deepseek-v4.1-flash-1017');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '[llm] compatibility warning: JSON Schema propertyNames' +
        ' — OpenAI does not support JSON Schema propertyNames.' +
        ' (identical warnings suppressed for this process)',
    );
  });

  test('the same warning under a different scope logs its own line', () => {
    const { lines, logger } = collector();

    logger.log(propertyNames, 'openai deepseek-v4.1-flash-1017');
    logger.log(propertyNames, 'anthropic claude-sonnet-4');

    expect(lines).toHaveLength(2);
  });

  test('the same type and feature with different details logs its own line', () => {
    const { lines, logger } = collector();

    logger.log(propertyNames, 'openai deepseek-v4.1-flash-1017');
    logger.log({ ...propertyNames, details: 'A different explanation.' }, 'openai deepseek-v4.1-flash-1017');

    expect(lines).toHaveLength(2);
  });

  test('a warning with no details omits the em dash', () => {
    const { lines, logger } = collector();

    logger.log({ type: 'other', feature: 'something' });

    expect(lines[0]).toBe(
      '[llm] other warning: something (identical warnings suppressed for this process)',
    );
  });
});

describe('namesRequestedCapability', () => {
  test('names the capabilities whose loss must fail the request', () => {
    for (const feature of ['thinking', 'reasoning', 'cache', 'response_format']) {
      expect(namesRequestedCapability({ type: 'unsupported', feature })).toBe(true);
    }
  });

  test('strict is an optional optimisation, not a requested capability', () => {
    expect(namesRequestedCapability({ type: 'unsupported', feature: 'strict' })).toBe(false);
  });
});