import { dlopen, FFIType, ptr, toArrayBuffer, CString } from 'bun:ffi';

// ---------------------------------------------------------------------------
// Landlock write confinement
// ---------------------------------------------------------------------------
//
// Landlock is a Linux LSM that lets an unprivileged process drop its own
// filesystem rights irreversibly. glibc ships NO wrappers for it, so every call
// here goes through raw `syscall()`. The syscall numbers below are identical on
// x86_64 and aarch64 (the architecturally assigned numbers), which is why one
// constant set covers both.
//
// IMPORTANT: applying a ruleset is permanent for the calling process and is
// inherited by everything it execs. This module must therefore only ever be
// called by a throwaway process (see jail_launcher.ts) or by a process that
// genuinely intends to spend the rest of its life confined.

const SYS_LANDLOCK_CREATE_RULESET = 444;
const SYS_LANDLOCK_ADD_RULE = 445;
const SYS_LANDLOCK_RESTRICT_SELF = 446;

const LANDLOCK_CREATE_RULESET_VERSION = 1;
const LANDLOCK_RULE_PATH_BENEATH = 1;

const PR_SET_NO_NEW_PRIVS = 38;

// Write-related access rights only. Deliberately no read (1<<0) or execute
// (1<<2) bits: restricting those needs a full allowlist of every library,
// binary and module path the system uses, and we only care about writes.
const ACCESS_FS_WRITE_FILE = 1n << 1n;
const ACCESS_FS_REMOVE_DIR = 1n << 4n;
const ACCESS_FS_REMOVE_FILE = 1n << 5n;
const ACCESS_FS_MAKE_CHAR = 1n << 6n;
const ACCESS_FS_MAKE_DIR = 1n << 7n;
const ACCESS_FS_MAKE_REG = 1n << 8n;
const ACCESS_FS_MAKE_SOCK = 1n << 9n;
const ACCESS_FS_MAKE_FIFO = 1n << 10n;
const ACCESS_FS_MAKE_BLOCK = 1n << 11n;
const ACCESS_FS_MAKE_SYM = 1n << 12n;
const ACCESS_FS_REFER = 1n << 13n; // ABI >= 2 only
const ACCESS_FS_TRUNCATE = 1n << 14n; // ABI >= 3 only

const O_CLOEXEC = 0x80000;
const O_DIRECTORY = 0x10000;
// O_PATH has no `fs.constants` entry in Node; the value is 0x200000 on every
// Linux architecture we target. O_PATH cannot read or write the target, so
// holding one is safe under the very ruleset being built from it.
const O_PATH = 0x200000;

const ENOSYS = 38;
const EOPNOTSUPP = 95;

// ABI >= 2 and >= 3 are the points where new rights became legal to name in a
// ruleset. Naming them on an older kernel makes landlock_add_rule fail EINVAL.
const ABI_REFER = 2;
const ABI_TRUNCATE = 3;

type Libc = ReturnType<typeof openLibc>;

function openLibc() {
  return dlopen('libc.so.6', {
    // `long syscall(long number, ...)` — bun:ffi cannot express a varargs
    // signature, so the pointer arguments are passed as BigInts produced by
    // ptr() and every slot is declared i64. The kernel only ever looks at the
    // slots it needs, so extra zeroes are harmless.
    syscall: {
      args: [FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.i64],
      returns: FFIType.i64,
    },
    open: {
      args: [FFIType.ptr, FFIType.i32, FFIType.i32],
      returns: FFIType.i32,
    },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    prctl: {
      args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64],
      returns: FFIType.i32,
    },
    __errno_location: { args: [], returns: FFIType.ptr },
    strerror: { args: [FFIType.i32], returns: FFIType.ptr },
  });
}

let cachedLibc: Libc | null = null;

function libc(): Libc {
  cachedLibc ??= openLibc();
  return cachedLibc;
}

function errno(): number {
  const location = libc().symbols.__errno_location();
  if (!location) return 0;
  return new DataView(toArrayBuffer(location, 0, 4)).getInt32(0, true);
}

function errnoMessage(code: number): string {
  try {
    const message = libc().symbols.strerror(code);
    return message ? new CString(message).toString() : `errno ${code}`;
  } catch {
    return `errno ${code}`;
  }
}

function toPtr(buffer: Uint8Array): bigint {
  return BigInt(ptr(buffer));
}

function currentAbi(): number | null {
  const result = libc().symbols.syscall(
    BigInt(SYS_LANDLOCK_CREATE_RULESET), 0n, 0n,
    BigInt(LANDLOCK_CREATE_RULESET_VERSION), 0n, 0n,
  );
  return result > 0n ? Number(result) : null;
}

function openPath(path: string, directory: boolean): number {
  const flags = O_PATH | O_CLOEXEC | (directory ? O_DIRECTORY : 0);
  const fd = libc().symbols.open(ptr(Buffer.from(`${path}\0`, 'utf8')), flags, 0);
  if (fd < 0) {
    throw new LandlockError(errno(), `cannot open "${path}": ${errnoMessage(errno())}`);
  }
  return fd;
}

class LandlockError extends Error {
  readonly errno: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'LandlockError';
    this.errno = code;
  }
}

export interface LandlockApplied {
  applied: true;
  abi: number;
}

export interface LandlockUnavailable {
  applied: false;
  /** `unsupported` = kernel/ABI missing, `not-linux` = other OS, `error` = syscall failed. */
  reason: 'unsupported' | 'not-linux' | 'error';
  message: string;
  errno?: number;
}

export type LandlockStatus = LandlockApplied | LandlockUnavailable;

export interface LandlockOptions {
  /** Directories the confined process may modify (recursively). */
  writableDirs: string[];
  /** Individual files the confined process may write to (character devices). */
  writableFiles?: string[];
}

/**
 * Probe whether this kernel supports Landlock. Non-destructive: it only asks
 * for the ABI version, it does not create or apply a ruleset.
 */
export function probeLandlock(): LandlockStatus {
  if (process.platform !== 'linux') {
    return { applied: false, reason: 'not-linux', message: `Landlock is Linux-only (platform is ${process.platform})` };
  }
  try {
    const abi = currentAbi();
    if (abi === null) {
      const code = errno();
      // ENOSYS: the syscall does not exist (older kernel, or built without it).
      // EOPNOTSUPP: the syscall exists but the LSM is disabled (lsm= boot arg).
      if (code === ENOSYS || code === EOPNOTSUPP) {
        return { applied: false, reason: 'unsupported', message: 'kernel does not support landlock', errno: code };
      }
      return { applied: false, reason: 'error', message: errnoMessage(code), errno: code };
    }
    return { applied: true, abi };
  } catch (err) {
    return {
      applied: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Apply an irreversible write-only Landlock ruleset to the CURRENT process.
 *
 * Everything not covered by `writableDirs` / `writableFiles` becomes
 * unwritable: no file creation, no truncation, no unlink, no rename, no mkdir —
 * anywhere on the filesystem. Reads and executes are untouched.
 *
 * After this returns `applied: true` the confinement cannot be lifted, revoked
 * or widened by this process or any child it execs.
 */
export function applyLandlock(options: LandlockOptions): LandlockStatus {
  const probe = probeLandlock();
  if (!probe.applied) return probe;

  const { abi } = probe;
  const lib = libc();

  let handled = ACCESS_FS_WRITE_FILE
    | ACCESS_FS_REMOVE_DIR | ACCESS_FS_REMOVE_FILE
    | ACCESS_FS_MAKE_CHAR | ACCESS_FS_MAKE_DIR | ACCESS_FS_MAKE_REG
    | ACCESS_FS_MAKE_SOCK | ACCESS_FS_MAKE_FIFO | ACCESS_FS_MAKE_BLOCK
    | ACCESS_FS_MAKE_SYM;
  if (abi >= ABI_REFER) handled |= ACCESS_FS_REFER;
  if (abi >= ABI_TRUNCATE) handled |= ACCESS_FS_TRUNCATE;

  const openedFds: number[] = [];
  let rulesetFd = -1;

  try {
    // `struct landlock_ruleset_attr { __u64 handled_access_fs; }`
    const attr = new Uint8Array(8);
    new DataView(attr.buffer).setBigUint64(0, handled, true);
    rulesetFd = Number(lib.symbols.syscall(
      BigInt(SYS_LANDLOCK_CREATE_RULESET), toPtr(attr), 8n, 0n, 0n, 0n,
    ));
    if (rulesetFd < 0) {
      throw new LandlockError(errno(), `landlock_create_ruleset: ${errnoMessage(errno())}`);
    }

    const addRule = (allowedAccess: bigint, parentFd: number) => {
      // `struct path_beneath_attr { __u64 allowed_access; __s32 parent_fd; }` —
      // the kernel requires this struct to be PACKED (12 bytes, no padding).
      const rule = new Uint8Array(12);
      const view = new DataView(rule.buffer);
      view.setBigUint64(0, allowedAccess, true);
      view.setInt32(8, parentFd, true);
      // NOTE: landlock_add_rule takes FOUR arguments. Omitting `flags` shifts
      // the argument registers and the kernel answers EINVAL.
      const result = lib.symbols.syscall(
        BigInt(SYS_LANDLOCK_ADD_RULE), BigInt(rulesetFd),
        BigInt(LANDLOCK_RULE_PATH_BENEATH), toPtr(rule), 0n, 0n,
      );
      if (result < 0n) {
        throw new LandlockError(errno(), `landlock_add_rule: ${errnoMessage(errno())}`);
      }
    };

    for (const dir of options.writableDirs) {
      const fd = openPath(dir, true);
      openedFds.push(fd);
      addRule(handled, fd);
    }

    // Character devices need their own rules: a write-rights-only ruleset
    // denies `> /dev/null`, which breaks almost every tool (git's
    // "could not open '/dev/null'"). Only WRITE_FILE is granted on them so
    // they cannot be truncated or replaced. A missing device (e.g. no tty in a
    // container) is skipped rather than failing the whole jail.
    for (const file of options.writableFiles ?? []) {
      let fd: number;
      try {
        fd = openPath(file, false);
      } catch {
        continue;
      }
      openedFds.push(fd);
      // A path under /dev can resolve to something that is not a filesystem
      // object at all (/dev/stdout is a pipe behind /proc/self/fd/1).
      // landlock_add_rule rejects those with EBADFD, and one such device must
      // not cost us the whole ruleset — that would silently disable the jail.
      // Skipping the rule means the path is simply not writable, which is the
      // conservative outcome.
      try {
        addRule(ACCESS_FS_WRITE_FILE, fd);
      } catch {
        // not a filesystem object; leave it outside the writable set
      }
    }

    // PR_SET_NO_NEW_PRIVS must be set BEFORE landlock_restrict_self: without it
    // the kernel refuses with EPERM, because a setuid binary could otherwise
    // regain the rights we just dropped.
    if (lib.symbols.prctl(PR_SET_NO_NEW_PRIVS, 1n, 0n, 0n, 0n) !== 0) {
      throw new LandlockError(errno(), `prctl(PR_SET_NO_NEW_PRIVS): ${errnoMessage(errno())}`);
    }

    const restrictResult = lib.symbols.syscall(
      BigInt(SYS_LANDLOCK_RESTRICT_SELF), BigInt(rulesetFd), 0n, 0n, 0n, 0n,
    );
    if (restrictResult < 0n) {
      throw new LandlockError(errno(), `landlock_restrict_self: ${errnoMessage(errno())}`);
    }

    return { applied: true, abi };
  } catch (err) {
    if (err instanceof LandlockError) {
      return { applied: false, reason: 'error', message: err.message, errno: err.errno };
    }
    return {
      applied: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // The ruleset is already latched into the process at restrict_self time;
    // the fds exist only to build it. Closing them keeps them out of the exec.
    for (const fd of openedFds) lib.symbols.close(fd);
    if (rulesetFd >= 0) lib.symbols.close(rulesetFd);
  }
}