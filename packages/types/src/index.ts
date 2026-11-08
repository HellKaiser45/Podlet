export type {
  ChatCompletionTool,
  ChatCompletionChunk,
  ChatCompletionMessageToolCall,
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions'

//==============================
// CONFIG
// =============================

export interface ConfigFile {
  server?: {
    port?: number;
    host?: string;
    webPort?: number;
  };
  database?: {
    path?: string;
  };
  features?: {
    safemode?: boolean;
    vision?: {
      enabled?: boolean;
      max_images_per_call?: number;
    };
  };
}

interface VisionSettings {
  enabled: boolean;
  max_images_per_call: number;
}

/**
 * One image returned by `see_image`. Defined once here so the tool that
 * produces the receipt and the hydration pass that consumes it agree on the
 * shape without duplicating it.
 */
export interface SeeImageReceipt {
  vpath: string;
  id: string;
  sha: string;
  source: {
    mime: string;
    width: number;
    height: number;
    bytes: number;
    mtime_ms: number; // source file mtime in ms at view time
  };
  rendered: {
    mime: string;
    width: number;
    height: number;
    bytes: number;
    format: 'png' | 'jpeg';
  };
  tokens_est: number;
  dropped_from_context: boolean;
}

export interface AppConfig {
  podletDir: string;
  dbName: string;
  port: number;
  host: string;
  webPort: number;
  dbPath: string;
  corsOrigin: string;
  safemode: boolean;
  vision: VisionSettings;
}
