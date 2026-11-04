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
    pythonPort?: number;
    webPort?: number;
  };
  database?: {
    path?: string;
  };
  features?: {
    safemode?: boolean;
    vision?: {
      enabled?: boolean;
      max_live_images?: number;
      max_bytes_per_request?: number;
      max_edge?: number;
      max_images_per_call?: number;
    };
  };
}

export interface VisionSettings {
  enabled: boolean;
  max_live_images: number;
  max_bytes_per_request: number;
  max_edge: number;
  max_images_per_call: number;
}

export interface AppConfig {
  podletDir: string;
  dbName: string;
  llmApiUrl: string;
  port: number;
  host: string;
  pythonPort: number;
  webPort: number;
  dbPath: string;
  corsOrigin: string;
  safemode: boolean;
  vision: VisionSettings;
}
