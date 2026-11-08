import type { CallWarning } from 'ai';

/**
 * A warning as we log it: the provider's own `type` plus the capability it
 * names, flattened from whichever `CallWarning` variant arrived.
 */
type DescribedWarning = { type: string; feature: string; details?: string };

export function describeWarning(warning: CallWarning): DescribedWarning {
  if ('feature' in warning) {
    return { type: warning.type, feature: warning.feature, details: warning.details };
  }
  if ('setting' in warning) {
    return { type: warning.type, feature: warning.setting, details: warning.message };
  }
  return { type: warning.type, feature: String(warning) };
}

/**
 * A warning feature that names an explicitly requested capability. If the
 * provider reports one of these as `unsupported`, the request must fail rather
 * than continue with the capability silently dropped.
 *
 * Note what is deliberately absent: `strict`. Anthropic reports
 * `{type:'unsupported', feature:'strict'}` on models without structured-output
 * support (@ai-sdk/anthropic dist/index.js:1950-1961). That is a provider
 * limitation on an optional optimisation, not a requested capability that went
 * missing — "strict" matches none of the entries below, so it only logs.
 */
const REQUESTED_CAPABILITIES = [
  'reason',
  'thinking',
  'cache',
  'responseformat',
  'response_format',
  'structured',
  'outputformat',
];

export function namesRequestedCapability(warning: DescribedWarning): boolean {
  const feature = warning.feature.toLowerCase();
  return REQUESTED_CAPABILITIES.some((capability) => feature.includes(capability));
}

type WarningSink = (line: string) => void;

type WarningLogger = {
  /** Log at most one line per unique (scope, type, feature, details) key. */
  log(warning: DescribedWarning, scope?: string): void;
  /**
   * Log at most one pre-formatted line per unique `key`. For diagnostics that
   * are not a provider `CallWarning` (they have no type/feature to flatten) but
   * still need this logger's process-wide dedupe rather than a second one.
   */
  note(key: string, line: string): void;
};

/**
 * A process-wide deduplicating warning printer.
 *
 * A provider's compatibility warnings are properties of the provider/model, not
 * of the individual call, yet `runLlmStream` runs once per tool-loop iteration,
 * so the same warning would otherwise repeat on every iteration of every turn.
 * Dedupe is logging-only: the caller's hard-failure throw is unaffected.
 */
export function createWarningLogger(sink: WarningSink = (line) => console.warn(line)): WarningLogger {
  const seen = new Set<string>();

  return {
    note(key: string, line: string): void {
      if (seen.has(key)) return;
      seen.add(key);
      sink(line);
    },

    log(warning: DescribedWarning, scope?: string): void {
      const key = `${scope ?? ''}|${warning.type}|${warning.feature}|${warning.details ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);

      const details = warning.details ? ` — ${warning.details}` : '';
      sink(
        `[llm] ${warning.type} warning: ${warning.feature}${details}` +
          ' (identical warnings suppressed for this process)',
      );
    },
  };
}