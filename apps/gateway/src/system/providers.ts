import type {
  AgentThinking,
  Health,
  ModelConfig,
  Protocol,
  ProviderQuirks,
} from "../types";

/**
 * Static provider lookup. This is data, not a heuristic: `provider` is matched
 * verbatim (case-sensitive, no trimming), and a miss is terminal — the entry is
 * unusable. It exists so that `models.json` keeps the `provider` string litellm
 * used to consume instead of gaining a new `kind`/`protocol` field.
 *
 * Deliberately absent: azure, vertex, bedrock. None of the three SDK factories
 * can reach them (Azure needs an `api-key` header + api-version query, Vertex
 * needs project/location + ADC, Bedrock needs SigV4), and a `bedrock` row that
 * pointed at the anthropic protocol would send an AWS credential to
 * api.anthropic.com.
 */
type ProviderRow = {
  protocol: Protocol;
  /** Default endpoint; an entry-level `base_url` always wins. */
  base_url?: string;
  /** Default key variable. Authoritative when present: a miss is terminal. */
  key_env?: string;
  headers?: Record<string, string>;
  api_key_optional?: boolean;
  quirks?: ProviderQuirks;
};

/**
 * Sent on every request to every provider. The deleted Python service only sent
 * it for opencode; the owner now wants it universally, so it is merged into the
 * resolved headers rather than repeated on each of the twelve rows.
 */
const DEFAULT_HEADERS: Record<string, string> = { 'User-Agent': 'Podlet/1.0' };

export const PROVIDER_TABLE: Record<string, ProviderRow> = {
  openai: {
    protocol: "openai",
    base_url: "https://api.openai.com/v1",
    key_env: "OPENAI_API_KEY",
  },
  anthropic: {
    protocol: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    key_env: "ANTHROPIC_API_KEY",
  },
  google: {
    protocol: "google",
    key_env: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  gemini: {
    protocol: "google",
    key_env: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
  openrouter: {
    protocol: "openai",
    base_url: "https://openrouter.ai/api/v1",
    key_env: "OPENROUTER_API_KEY",
    headers: {
      "HTTP-Referer": "https://github.com/HellKaiser45/Podlet",
      "X-OpenRouter-Title": "Podlet",
    },
  },
  zai: {
    protocol: "openai",
    key_env: "ZAI_API_KEY",
  },
  opencode: {
    protocol: "openai",
    key_env: "OPENCODE_API_KEY",
    // The per-conversation `x-opencode-session` header is dynamic, so the row
    // only declares that the provider wants it (see llm/conversation.ts).
    quirks: { opencode_session: true, no_stream_options: true },
  },
  moonshot: {
    protocol: "openai",
    base_url: "https://api.moonshot.ai/v1",
    key_env: "MOONSHOT_API_KEY",
  },
  deepseek: {
    protocol: "openai",
    base_url: "https://api.deepseek.com/v1",
    key_env: "DEEPSEEK_API_KEY",
  },
  groq: {
    protocol: "openai",
    base_url: "https://api.groq.com/openai/v1",
    key_env: "GROQ_API_KEY",
  },
  ollama: {
    protocol: "openai",
    base_url: "http://localhost:11434/v1",
    key_env: "OLLAMA_API_KEY",
    api_key_optional: true,
    // Rejects unknown request fields: asking for usage would 400 every call.
    quirks: { no_stream_options: true },
  },
  lm_studio: {
    protocol: "openai",
    base_url: "http://localhost:1234/v1",
    key_env: "LM_STUDIO_API_KEY",
    api_key_optional: true,
    // Rejects unknown request fields: asking for usage would 400 every call.
    quirks: { no_stream_options: true },
  },
};

/**
 * Membership test only: does the named provider already point at the SDK's own
 * canonical endpoint? A miss means "a base_url is required", which is an error —
 * never a substituted endpoint.
 */
const CANONICAL_FOR: Record<Protocol, string[]> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  google: ["google", "gemini"],
};

/** Default key variable per protocol; used only when nothing named one earlier. */
const KEY_ENV_BY_PROTOCOL: Record<Protocol, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

type KeySource = "api_key_name" | "provider" | "protocol";

export type ResolvedModel = {
  health: Health;
  protocol?: Protocol;
  base_url?: string;
  /** Undefined when the resolved key variable is optional and unset. */
  api_key?: string;
  key_var?: string;
  key_source?: KeySource;
  headers: Record<string, string>;
  quirks: ProviderQuirks;
};

function unusable(reason: string, quirks: ProviderQuirks = {}): ResolvedModel {
  return { health: { status: "unusable", reason }, headers: {}, quirks };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Mirrors the deleted Python service's `_is_opencode()`: the provider is named
 * `opencode`, OR its base_url points at opencode.ai. The base_url test matters
 * because opencode can also be configured as a generic openai-compatible
 * provider under a different name.
 */
function isOpencode(
  row: ProviderRow,
  entryBaseUrl: unknown,
  resolvedBaseUrl: string | undefined,
): boolean {
  for (const candidate of [entryBaseUrl, resolvedBaseUrl, row.base_url]) {
    if (typeof candidate === "string" && candidate.includes("opencode.ai")) return true;
  }
  return false;
}

/**
 * Resolve one `models.json` entry to everything a request needs, or to a reason
 * that names the offending field and the fix. Never throws, never falls back.
 *
 * Order of checks is the §4.8 precedence:
 * unknown provider -> reasoning_effort present -> base_url -> key.
 */
export function resolveModel(
  name: string,
  entry: unknown,
  env: Record<string, string | undefined> = process.env,
): ResolvedModel {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return unusable(`model '${name}': entry must be an object, got ${Array.isArray(entry) ? "an array" : typeof entry}`);
  }
  const config = entry as Partial<ModelConfig> & Record<string, unknown>;

  // An unusable entry still carries the quirks it declared: the quirk may be
  // what explains a *different* check failing, and dropping it here would make
  // the stored config and the resolved model disagree about the model entirely.
  const storedQuirks: ProviderQuirks =
    config.quirks !== null && typeof config.quirks === "object" && !Array.isArray(config.quirks)
      ? { ...config.quirks }
      : {};

  if (config.reasoning_effort !== undefined) {
    return unusable(
      `model '${name}': reasoning_effort is no longer a model setting — delete the "reasoning_effort" key; thinking is now per agent (agent.thinking: none|low|medium|high)`,
      storedQuirks,
    );
  }

  if (!isNonEmptyString(config.provider)) {
    return unusable(`model '${name}': provider must be a non-empty string`, storedQuirks);
  }
  if (!isNonEmptyString(config.model)) {
    return unusable(`model '${name}': model must be a non-empty string`, storedQuirks);
  }

  // --- provider: the table is the only knob, and a miss is terminal. There is
  // no entry-level override of the protocol — the provider string decides it.
  const row = PROVIDER_TABLE[config.provider];
  if (!row) {
    return unusable(
      `model '${name}': unknown provider '${config.provider}'; it is not in the supported provider table — use one of the supported provider names with an entry-level base_url pointing at your own endpoint, or set api_key_name for a non-standard key variable`,
      storedQuirks,
    );
  }
  const protocol: Protocol = row.protocol;

  // --- base_url: entry wins, then the row, then the SDK's own default.
  let baseUrl: string | undefined;
  if (config.base_url !== undefined) {
    if (!isNonEmptyString(config.base_url) || !isHttpUrl(config.base_url)) {
      return unusable(
        `model '${name}': base_url '${String(config.base_url)}' is not a valid http(s) URL`,
        storedQuirks,
      );
    }
    baseUrl = config.base_url;
  } else if (row.base_url !== undefined) {
    baseUrl = row.base_url;
  } else if (!CANONICAL_FOR[protocol].includes(config.provider)) {
    return unusable(
      `model '${name}': base_url required for provider '${config.provider}' (protocol '${protocol}')`,
      storedQuirks,
    );
  }

  // --- key: the step that names a variable is final. No try-next-variable chain.
  let keyVar: string;
  let keySource: KeySource;
  if (config.api_key_name !== undefined) {
    if (!isNonEmptyString(config.api_key_name)) {
      return unusable(`model '${name}': api_key_name must be a non-empty string`, storedQuirks);
    }
    keyVar = config.api_key_name;
    keySource = "api_key_name";
  } else if (row.key_env !== undefined) {
    keyVar = row.key_env;
    keySource = "provider";
  } else {
    keyVar = KEY_ENV_BY_PROTOCOL[protocol];
    keySource = "protocol";
  }

  const rawKey = env[keyVar];
  const apiKey = typeof rawKey === "string" && rawKey.length > 0 ? rawKey : undefined;
  if (apiKey === undefined) {
    const optional = config.api_key_optional === true || row.api_key_optional === true;
    if (!optional) {
      return unusable(`model '${name}': no API key — set ${keyVar} (from ${keySource})`, storedQuirks);
    }
  }

  if (config.headers !== undefined && (config.headers === null || typeof config.headers !== "object" || Array.isArray(config.headers))) {
    return unusable(`model '${name}': headers must be an object of string values`, storedQuirks);
  }
  // Row defaults first, then the universal User-Agent, then the entry's own
  // headers — so an entry can override the default if it ever needs to.
  const headers: Record<string, string> = { ...(row.headers ?? {}), ...DEFAULT_HEADERS };
  for (const [key, value] of Object.entries(config.headers ?? {})) {
    if (typeof value !== "string") {
      return unusable(`model '${name}': headers['${key}'] must be a string`, storedQuirks);
    }
    headers[key] = value;
  }
  if (config.quirks !== undefined && (config.quirks === null || typeof config.quirks !== "object" || Array.isArray(config.quirks))) {
    return unusable(`model '${name}': quirks must be an object`, storedQuirks);
  }
  return {
    health: { status: "ok" },
    protocol,
    base_url: baseUrl,
    api_key: apiKey,
    key_var: keyVar,
    key_source: keySource,
    headers,
    quirks: isOpencode(row, config.base_url, baseUrl)
      ? {
          ...(row.quirks ?? {}),
          ...(config.quirks ?? {}),
          opencode_session: true,
          // Whatever the provider name, an opencode.ai endpoint rejects
          // `stream_options`: without the opt-out every call 400s. A rename
          // must not drop it (the row's own quirks are not merged here).
          no_stream_options: true,
        }
      : { ...(row.quirks ?? {}), ...(config.quirks ?? {}) },
  };
}

/**
 * A quirk may not silently disable a requested capability: a model that rejects
 * `reasoning_effort` cannot serve an agent that asks for thinking. Returns the
 * reason string when the combination is a guaranteed request-time failure.
 */
export function thinkingQuirkConflict(
  modelName: string,
  agentId: string,
  thinking: AgentThinking | undefined,
  resolved: ResolvedModel,
): string | undefined {
  const level = thinking ?? "none";
  if (!resolved.quirks.no_reasoning_effort || level === "none") return undefined;
  return `model '${modelName}': this provider rejects reasoning_effort; agent '${agentId}' requests thinking '${level}'`;
}