import { dlopen, FFIType, ptr } from 'bun:ffi';
import { applyLandlock, type LandlockOptions, type LandlockStatus } from './landlock';

// ---------------------------------------------------------------------------
// Landlock jail launcher
// ---------------------------------------------------------------------------
//
// Invoked as:  bun run jail_launcher.ts '<spec>' -- <command> [args...]
//
// where `<spec>` is JSON:
//   {
//     "writableDirs":  ["/abs/dir", ...],       // recursive write access
//     "writableFiles": ["/dev/null", ...]       // WRITE_FILE only (devices)
//   }
//
// A bare absolute path is still accepted and read as a one-entry
// `writableDirs` (with /dev/null and /dev/tty as the only writable files), so
// older callers keep working.
//
// Landlock confinement is per-process and irreversible, so it can never be
// applied inside the gateway: the gateway would jail itself and every later
// tool call with it. Instead this script is spawned as a short-lived process
// that confines itself and then REPLACES itself with the real command via
// execvp. The result is a shell that is both jailed and orphaned — no jailed
// parent lingers to be inherited by anything else.
//
// The status line below is the only channel back to the gateway. It is printed
// before the exec, so the parent reads the truth about whether confinement
// actually took effect rather than assuming it did.

const STATUS_PREFIX = '[podlet-jail] ';

const DEFAULT_WRITABLE_FILES = ['/dev/null', '/dev/tty'];

function emitStatus(status: LandlockStatus): void {
  process.stderr.write(STATUS_PREFIX + JSON.stringify(status) + '\n');
}

function fail(message: string): never {
  process.stderr.write(`jail_launcher: ${message}\n`);
  process.exit(64);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

/** Parse the spec argument into the options applyLandlock() wants. */
function parseJailSpec(raw: string): LandlockOptions {
  if (!raw.trimStart().startsWith('{')) {
    return { writableDirs: [raw], writableFiles: DEFAULT_WRITABLE_FILES };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('jail spec is not valid JSON');
  }

  const spec = parsed as { writableDirs?: unknown; writableFiles?: unknown };
  if (!isStringArray(spec.writableDirs) || spec.writableDirs.length === 0) {
    fail('jail spec needs a non-empty "writableDirs" array of paths');
  }
  if (spec.writableFiles !== undefined && !isStringArray(spec.writableFiles)) {
    fail('jail spec "writableFiles" must be an array of paths');
  }

  return {
    writableDirs: spec.writableDirs,
    writableFiles: spec.writableFiles ?? DEFAULT_WRITABLE_FILES,
  };
}

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');

if (separator < 1) {
  process.stderr.write("usage: jail_launcher.ts '<json-spec>| <writable-root>' -- <command> [args...]\n");
  process.exit(64);
}

const jailOptions = parseJailSpec(argv[0]);
const command = argv.slice(separator + 1);

if (command.length === 0) {
  process.stderr.write('jail_launcher: no command given\n');
  process.exit(64);
}

// Degraded, not crashed: if Landlock is unavailable the command still runs, and
// the caller is told so it can warn the user.
const status = applyLandlock(jailOptions);

emitStatus(status);

// execvp (not execve) so `bash` is found through PATH, and via libc (not
// process.execve) so the experimental-API warning never lands in the tool's
// stderr. Either way the image is replaced: no jailed parent survives.
const libc = dlopen('libc.so.6', {
  execvp: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
});

const argumentBuffers = command.map(arg => Buffer.from(`${arg}\0`, 'utf8'));
const argumentPointers = new BigInt64Array(argumentBuffers.length + 1);
argumentBuffers.forEach((buffer, index) => {
  argumentPointers[index] = BigInt(ptr(buffer));
});
argumentPointers[argumentBuffers.length] = 0n;

libc.symbols.execvp(ptr(argumentBuffers[0]), ptr(argumentPointers));

// execvp only returns on failure.
process.stderr.write(`jail_launcher: cannot exec ${command[0]}\n`);
process.exit(127);
