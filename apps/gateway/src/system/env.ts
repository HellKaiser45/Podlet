import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Hand-written `~/.podlet/.env` reader. Python has always loaded this file
 * (python-dotenv, agent_core_py/core.py); the TS side classifies models against
 * `process.env`, so without this loader a key that only lives in `.env` reads as
 * absent and its model is reported unusable.
 *
 * Deliberately not a dotenv implementation: no interpolation, no multi-line
 * values, no `#` comment stripping inside a value.
 */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `key -> value we wrote`, so a later reload only touches values we own. */
const written = new Map<string, string>()

export function parseEnvFile(text: string): { values: Record<string, string>; warnings: string[] } {
  const values: Record<string, string> = {}
  const warnings: string[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].replace(/\r$/, '')
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) continue

    let body = trimmed
    if (body === 'export' || body.startsWith('export ')) {
      body = body.slice('export'.length).trim()
    }

    const eq = body.indexOf('=')
    if (eq === -1) {
      warnings.push(`line ${lineNo}: missing '='`)
      continue
    }

    const key = body.slice(0, eq).trim()
    if (!KEY_PATTERN.test(key)) {
      warnings.push(`line ${lineNo}: invalid key`)
      continue
    }

    // Later duplicate wins: plain assignment into the same record.
    values[key] = parseValue(body.slice(eq + 1))
  }

  return { values, warnings }
}

/**
 * Unquoted values are trimmed; a `#` inside one is part of the value, not a
 * comment (`KEY=v # trailing` yields `v # trailing`).
 */
function parseValue(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeDoubleQuoted(trimmed.slice(1, -1))
  }
  return trimmed
}

function unescapeDoubleQuoted(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char !== '\\') {
      out += char
      continue
    }
    const next = value[i + 1]
    if (next === undefined) {
      out += '\\'
      break
    }
    switch (next) {
      case 'n': out += '\n'; break
      case 'r': out += '\r'; break
      case 't': out += '\t'; break
      case '\\': out += '\\'; break
      case '"': out += '"'; break
      default: out += '\\' + next; break
    }
    i++
  }
  return out
}

/**
 * Read `<podletDir>/.env` into `process.env`. A real environment variable always
 * wins over the file: on the first call a key is only set when it is undefined,
 * and on a reload only when the current value is still the one we wrote (so a
 * value changed in the shell is never clobbered). A key that disappeared from
 * the file is removed again, but only if it still holds what we wrote.
 *
 * A missing file is legitimate (Docker supplies keys as real env), so it is a
 * silent no-op. Malformed lines are collected as warnings, never thrown.
 */
export async function applyEnvFile(
  podletDir: string,
): Promise<{ path: string; loaded: string[]; warnings: string[] }> {
  const path = join(podletDir, '.env')

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    const code = e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') return { path, loaded: [], warnings: [] }
    throw e
  }

  const { values, warnings } = parseEnvFile(text)
  const loaded: string[] = []

  for (const [key, value] of Object.entries(values)) {
    const current = process.env[key]
    const previous = written.get(key)

    if (current === undefined) {
      process.env[key] = value
      written.set(key, value)
      loaded.push(key)
    } else if (previous !== undefined && current === previous && current !== value) {
      process.env[key] = value
      written.set(key, value)
      loaded.push(key)
    }
    // Otherwise: either the shell supplied it, or it was overridden at runtime.
    // Leave it alone and do not take ownership of it.
  }

  for (const [key, previous] of [...written]) {
    if (Object.prototype.hasOwnProperty.call(values, key)) continue
    if (process.env[key] === previous) {
      delete process.env[key]
      loaded.push(key)
    }
    written.delete(key)
  }

  return { path, loaded, warnings }
}

/** Drops the ownership bookkeeping a previous apply left behind. */
export function resetEnvLoaderForTests(): void {
  written.clear()
}