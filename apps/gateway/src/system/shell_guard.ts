// ---------------------------------------------------------------------------
// Shell deny-list guard
// ---------------------------------------------------------------------------
//
// BEST-EFFORT FILTER, NOT A SANDBOX.
//
// This module recognises the obvious ways a model tries to (a) read the process
// environment and provider API keys and (b) reach outside the per-run
// directory. It is a deny-list of recognisable patterns: a shell script, a
// base64 blob, a heredoc, an alias, or a command assembled by string
// concatenation all get past it. A `null` return means "no obvious pattern
// seen", never "this command is safe".
//
// The inner-command recursion below (quotes, `$(...)`, backticks) and the
// argument checks (home-relative readers, absolute write targets) are still
// heuristics. An obfuscated command — a base64 payload, a downloaded script, or
// an interpreter one-liner that does not contain one of the markers below —
// still bypasses them. The real confinement is the Landlock write jail
// (landlock.ts and jail_launcher.ts), which is what actually stops a command
// from writing outside its writable set; Landlock, not this file, remains the
// real write confinement. This guard exists to fail the obvious attempts fast,
// with a message that tells the model to stop instead of improvising a
// workaround the kernel would only reject with EACCES.
//
// Pure module: no filesystem access, no spawning, no imports.

export interface ShellGuardViolation {
  /** Stable rule id, e.g. 'env-dump'. */
  rule: string;
  /** Agent-facing message. Must say what was blocked and what to do instead. */
  message: string;
}

export interface ShellGuardContext {
  /** Real absolute path of the per-run root. Commands run with this as cwd. */
  runRoot: string;
}

const HINT =
  'This shell is restricted to the run directory; read_file, write_file and apply_diff operate on workspace/, artifacts/ and skills/.';

function withHint(message: string): string {
  return `${message}\n${HINT}`;
}

// How many times a quoted / substituted inner command may be re-scanned. Three
// covers `bash -c "sh -c \"env\""` while bounding pathological nesting.
const MAX_INNER_DEPTH = 3;

// Leading `VAR=value` assignments are dropped before the command name is read,
// so `FOO=1 env` is still recognised as `env`.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/;

const WRAPPERS = new Set(['command', 'exec', 'nohup', 'time', 'nice']);

const ENV_DUMP_COMMANDS = new Set(['env', 'printenv', 'set', 'declare', 'compgen']);

const ENV_INTERPRETERS = new Set([
  'python', 'python3', 'node', 'bun', 'deno', 'ruby', 'perl', 'php', 'lua', 'Rscript',
]);

const INTERPRETER_ENV_MARKERS = [
  /\bos\.environ\b/,
  /\bos\.getenv\b/,
  /\bprocess\.env\b/,
  /\bDeno\.env\b/,
  /\bENV\[/,
];

const PRIVILEGE_COMMANDS = new Set(['sudo', 'su', 'doas', 'pkexec']);

const ISOLATION_COMMANDS = new Set([
  'docker', 'podman', 'nerdctl', 'unshare', 'nsenter', 'chroot',
  'mount', 'umount', 'systemctl', 'service',
]);

const CD_COMMANDS = new Set(['cd', 'pushd', 'popd']);

const READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'strings', 'grep', 'awk', 'sed', 'od', 'xxd',
]);

const WRITE_COMMANDS = new Set([
  'tee', 'dd', 'chmod', 'chown', 'chgrp', 'ln', 'mv', 'cp', 'rm', 'rmdir',
  'truncate', 'touch', 'mkdir', 'install', 'mkfifo',
]);

const SECRET_VAR = /API_?KEY|_KEY\b|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;

// `${VAR}` / `$VAR` references anywhere in the raw command string.
const VARIABLE_REFERENCE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

// `> target` / `>> target`, quoted or bare. A target beginning with `&` (as in
// `2>&1`) is a file-descriptor duplication, not a path, and is not captured.
const REDIRECT_TARGET = />>?\s*("[^"]*"|'[^']*'|[^\s;&|)]+)/g;

const REDIRECT_DEVICE_ALLOWLIST = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']);

// Home- and user-relative roots reached without a leading `/`.
const HOME_PATH = /^\$\{?HOME\}?(\/|$)/;
const USER_PATH = /^\$\{?USER\}?(\/|$)/;

function stripQuotes(raw: string): string {
  return raw
    .trim()
    .replace(/^["']+/, '')
    .replace(/["']+$/, '')
    .replace(/;+$/, '')
    .replace(/^["']+/, '')
    .replace(/["']+$/, '');
}

function basename(token: string): string {
  const trimmed = token.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

interface Segment {
  name: string;
  args: string[];
}

function parseSegment(raw: string): Segment | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map(stripQuotes)
    .filter(token => token.length > 0);

  let index = 0;
  while (index < tokens.length && ASSIGNMENT.test(tokens[index] ?? '')) index++;

  if (index >= tokens.length) return null;

  let name = basename(tokens[index] ?? '');
  index++;

  // One level of wrapper only: `command env`, `nice -n 5 env`,
  // `timeout 10 env`.
  if (name === 'timeout') {
    const duration = tokens[index];
    if (duration !== undefined && /^\d+(?:\.\d+)?[smhd]?$/.test(duration)) index++;
    const inner = tokens[index];
    if (inner === undefined) return null;
    name = basename(inner);
    index++;
  } else if (WRAPPERS.has(name)) {
    const inner = tokens[index];
    if (inner === undefined) return null;
    name = basename(inner);
    index++;
  }

  return { name, args: tokens.slice(index) };
}

// Quote- and substitution-aware split, so `python3 -c "os.environ"` and
// `bash -c "a; b"` stay a single simple command.
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let substitutionDepth = 0;
  let backtick = false;

  for (let index = 0; index < command.length; index++) {
    const char = command.charAt(index);
    const next = command.charAt(index + 1);

    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
        current += char;
        continue;
      }
      if (char === '$' && next === '(') {
        substitutionDepth++;
        current += '$(';
        index++;
        continue;
      }
      if (char === ')' && substitutionDepth > 0) {
        substitutionDepth--;
        current += char;
        continue;
      }
      current += char;
      continue;
    }

    if (backtick) {
      if (char === '`') backtick = false;
      current += char;
      continue;
    }

    if (char === '"') {
      quote = '"';
      current += char;
      continue;
    }
    if (char === "'") {
      quote = "'";
      current += char;
      continue;
    }
    if (char === '`') {
      backtick = true;
      current += char;
      continue;
    }
    if (char === '$' && next === '(') {
      substitutionDepth++;
      current += '$(';
      index++;
      continue;
    }
    if (char === ')' && substitutionDepth > 0) {
      substitutionDepth--;
      current += char;
      continue;
    }

    if (substitutionDepth === 0) {
      if (char === '|' && next === '|') {
        segments.push(current);
        current = '';
        index++;
        continue;
      }
      if (char === '&' && next === '&') {
        segments.push(current);
        current = '';
        index++;
        continue;
      }
      if (char === '|' || char === ';' || char === '\n') {
        segments.push(current);
        current = '';
        continue;
      }
    }

    current += char;
  }

  segments.push(current);
  return segments;
}

// Every `$(...)`, `` `...` ``, `"..."` and `'...'` body in `text`, verbatim.
function innerSnippets(text: string): string[] {
  const snippets: string[] = [];

  for (let index = 0; index < text.length; index++) {
    if (text.charAt(index) !== '$' || text.charAt(index + 1) !== '(') continue;
    let depth = 1;
    let cursor = index + 2;
    let body = '';
    while (cursor < text.length && depth > 0) {
      const char = text.charAt(cursor);
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) break;
      }
      body += char;
      cursor++;
    }
    if (body.length > 0) snippets.push(body);
    index = cursor - 1;
  }

  for (const match of text.matchAll(/`([^`]*)`/g)) {
    const body = match[1] ?? '';
    if (body.length > 0) snippets.push(body);
  }

  for (const match of text.matchAll(/"([^"]*)"/g)) {
    const body = match[1] ?? '';
    if (body.length > 0) snippets.push(body);
  }

  for (const match of text.matchAll(/'([^']*)'/g)) {
    const body = match[1] ?? '';
    if (body.length > 0) snippets.push(body);
  }

  return snippets;
}

function isInsideRunRoot(path: string, runRoot: string): boolean {
  if (runRoot.length === 0) return false;
  return path === runRoot || path.startsWith(`${runRoot}/`);
}

// --- whole-command scans ---------------------------------------------------
// These rules are not tied to a single simple command, so they run once over
// the raw string.

function findSecretVariable(command: string): string | null {
  for (const match of command.matchAll(VARIABLE_REFERENCE)) {
    const name = match[1];
    if (name !== undefined && SECRET_VAR.test(name)) return name;
  }
  return null;
}

function findDotenvReference(command: string): boolean {
  if (command.includes('/proc/') && command.includes('environ')) return true;
  for (const rawToken of command.split(/\s+/)) {
    const token = stripQuotes(rawToken);
    if (token.length > 0 && basename(token) === '.env') return true;
  }
  return false;
}

function findOutsideRedirection(command: string): string | null {
  for (const match of command.matchAll(REDIRECT_TARGET)) {
    const target = stripQuotes(match[1] ?? '');
    if (target.length === 0) continue;
    if (!target.startsWith('/') && !target.startsWith('~')) continue;
    if (REDIRECT_DEVICE_ALLOWLIST.has(target)) continue;
    return target;
  }
  return null;
}

function wholeCommandViolation(command: string): ShellGuardViolation | null {
  if (findSecretVariable(command) !== null) {
    return {
      rule: 'env-secret',
      message:
        'Blocked: provider credentials must not be read from the environment. Use the configured model and tools instead of inspecting API keys.',
    };
  }

  if (findDotenvReference(command)) {
    return {
      rule: 'dotenv-read',
      message: withHint(
        "Blocked: reading .env files or process environments is not permitted. If you need configuration values, read the project's own config files under artifacts/.",
      ),
    };
  }

  if (findOutsideRedirection(command) !== null) {
    return {
      rule: 'write-outside',
      message: withHint(
        'Blocked: output redirection outside the run directory is not permitted. Write under artifacts/.',
      ),
    };
  }

  return null;
}

// --- per-segment scans -----------------------------------------------------

function isOutsidePathArgument(argument: string): boolean {
  return (
    argument.startsWith('/')
    || argument.startsWith('~')
    || HOME_PATH.test(argument)
    || USER_PATH.test(argument)
  );
}

function findOutsideReadArgument(segment: Segment, runRoot: string): string | null {
  for (const argument of segment.args) {
    if (!argument.startsWith('/')) {
      if (argument.startsWith('~') || HOME_PATH.test(argument) || USER_PATH.test(argument)) {
        return argument;
      }
      continue;
    }
    if (argument.startsWith('/dev/')) continue;
    if (isInsideRunRoot(argument, runRoot)) continue;
    return argument;
  }
  return null;
}

function readsProcessEnvironment(segment: Segment): boolean {
  if (!ENV_INTERPRETERS.has(segment.name)) return false;
  const argumentText = segment.args.join(' ');
  if (argumentText.length === 0) return false;
  return INTERPRETER_ENV_MARKERS.some(marker => marker.test(argumentText));
}

// The paths a write-capable command would create or modify.
function writeTargets(segment: Segment): string[] {
  if (segment.name === 'dd') {
    return segment.args
      .filter(argument => argument.startsWith('of='))
      .map(argument => argument.slice('of='.length));
  }
  return segment.args.filter(argument => !argument.startsWith('-'));
}

function findOutsideWriteTarget(segment: Segment, runRoot: string): string | null {
  for (const target of writeTargets(segment)) {
    if (target.length === 0) continue;
    if (!isOutsidePathArgument(target)) continue;
    if (target.startsWith('/dev/')) continue;
    if (isInsideRunRoot(target, runRoot)) continue;
    return target;
  }
  return null;
}

function segmentViolation(segment: Segment, runRoot: string): ShellGuardViolation | null {
  if (ENV_DUMP_COMMANDS.has(segment.name)) {
    return {
      rule: 'env-dump',
      message:
        'Blocked: dumping the process environment is not permitted — it contains provider API keys. If a command needs a variable, reference it directly (for example $PATH or $HOME).',
    };
  }

  if (readsProcessEnvironment(segment)) {
    return {
      rule: 'env-interpreter',
      message: withHint(
        'Blocked: reading the process environment from an inline script is not permitted — it contains provider API keys. Do not inspect API keys; use the configured model and tools.',
      ),
    };
  }

  if (PRIVILEGE_COMMANDS.has(segment.name)) {
    return {
      rule: 'privilege',
      message: withHint(
        'Blocked: privilege escalation is not available in this sandbox. Commands run as an unprivileged user.',
      ),
    };
  }

  if (ISOLATION_COMMANDS.has(segment.name)) {
    return {
      rule: 'isolation-escape',
      message: withHint(
        'Blocked: container and namespace tools are not available — this shell is already isolated. Work inside artifacts/.',
      ),
    };
  }

  if (CD_COMMANDS.has(segment.name)) {
    const target = segment.args[0];
    if (
      target !== undefined
      && (target.startsWith('/') || target.startsWith('~') || target.includes('..'))
    ) {
      return {
        rule: 'cd-outside',
        message: withHint(
          'Blocked: leaving the run directory is not permitted. Paths are relative to the run root and start with workspace/, artifacts/ or skills/.',
        ),
      };
    }
  }

  if (READ_COMMANDS.has(segment.name) && findOutsideReadArgument(segment, runRoot) !== null) {
    return {
      rule: 'read-outside',
      message: withHint(
        'Blocked: reading files outside the run directory is not permitted. Everything you need is under workspace/ and artifacts/.',
      ),
    };
  }

  if (WRITE_COMMANDS.has(segment.name) && findOutsideWriteTarget(segment, runRoot) !== null) {
    return {
      rule: 'write-outside-cmd',
      message: withHint(
        'Blocked: writing outside the run directory is not permitted. Everything you produce must live under artifacts/.',
      ),
    };
  }

  return null;
}

function checkInternal(
  command: string,
  runRoot: string,
  depth: number,
): ShellGuardViolation | null {
  const whole = wholeCommandViolation(command);
  if (whole !== null) return whole;

  for (const raw of splitSegments(command)) {
    const segment = parseSegment(raw);
    if (segment !== null) {
      const violation = segmentViolation(segment, runRoot);
      if (violation !== null) return violation;
    }

    // The command name may be hidden in a quoted or substituted inner command.
    // The same "first token is the command name" rule is applied to the
    // extracted text, so prose that merely contains `env` stays clean.
    if (depth < MAX_INNER_DEPTH) {
      for (const snippet of innerSnippets(raw)) {
        const inner = checkInternal(snippet, runRoot, depth + 1);
        if (inner !== null) return inner;
      }
    }
  }

  return null;
}

/**
 * Return the first rule violated by `command`, or `null` when no obvious
 * pattern matched. `null` is not a safety guarantee — see the module header.
 */
export function checkShellCommand(command: string, context: ShellGuardContext): ShellGuardViolation | null {
  return checkInternal(command, context.runRoot, 0);
}