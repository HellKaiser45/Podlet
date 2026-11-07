import { describe, expect, test } from 'bun:test';
import type { ChatCompletionTool } from '@podlet/types';
import { findUnenforceableSchemaKeywords } from '../src/llm/schema-compat';

function tool(name: string, parameters: unknown): ChatCompletionTool {
  return {
    type: 'function',
    function: { name, parameters: parameters as Record<string, unknown> },
  };
}

describe('findUnenforceableSchemaKeywords', () => {
  test('a schema with no watched keyword reports nothing', () => {
    const tools = [
      tool('plain', {
        type: 'object',
        properties: { q: { type: 'string', description: 'query' } },
        required: ['q'],
      }),
    ];
    expect(findUnenforceableSchemaKeywords(tools)).toEqual([]);
  });

  test('propertyNames at the schema root is reported at its own path', () => {
    const tools = [tool('rooted', { type: 'object', propertyNames: { pattern: '^[a-z]+$' } })];
    expect(findUnenforceableSchemaKeywords(tools)).toEqual([
      { toolName: 'rooted', keyword: 'propertyNames', path: 'propertyNames' },
    ]);
  });

  test('propertyNames nested under properties is reported with the full path', () => {
    const tools = [
      tool('nested', {
        type: 'object',
        properties: {
          env: {
            type: 'object',
            propertyNames: { pattern: '^[A-Z_]+$' },
            additionalProperties: { type: 'string' },
          },
        },
      }),
    ];
    expect(findUnenforceableSchemaKeywords(tools)).toEqual([
      { toolName: 'nested', keyword: 'propertyNames', path: 'properties.env.propertyNames' },
    ]);
  });

  test('propertyNames inside items is reported', () => {
    const tools = [
      tool('listed', {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: { type: 'object', propertyNames: { pattern: '^x' } },
          },
        },
      }),
    ];
    expect(findUnenforceableSchemaKeywords(tools)).toEqual([
      {
        toolName: 'listed',
        keyword: 'propertyNames',
        path: 'properties.entries.items.propertyNames',
      },
    ]);
  });

  test('each tool carrying the keyword is reported once', () => {
    const tools = [
      tool('first', { type: 'object', properties: { a: { propertyNames: { pattern: '^a' } } } }),
      tool('second', { type: 'object', propertyNames: { pattern: '^b' } }),
      tool('third', { type: 'object', properties: { c: { type: 'string' } } }),
    ];
    const occurrences = findUnenforceableSchemaKeywords(tools);
    expect(occurrences).toEqual([
      { toolName: 'first', keyword: 'propertyNames', path: 'properties.a.propertyNames' },
      { toolName: 'second', keyword: 'propertyNames', path: 'propertyNames' },
    ]);
  });

  test('a cyclic schema neither hangs nor throws', () => {
    const cyclic: Record<string, any> = { type: 'object', properties: {} };
    cyclic.properties.self = cyclic;
    cyclic.properties.env = { type: 'object', propertyNames: { pattern: '^[a-z]+$' } };

    expect(findUnenforceableSchemaKeywords([tool('cyclic', cyclic)])).toEqual([
      { toolName: 'cyclic', keyword: 'propertyNames', path: 'properties.env.propertyNames' },
    ]);
  });

  test('undefined tools returns an empty list', () => {
    expect(findUnenforceableSchemaKeywords(undefined)).toEqual([]);
  });
});