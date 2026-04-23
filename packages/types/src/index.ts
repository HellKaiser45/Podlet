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
    cors_enabled?: boolean;
  };
  database?: {
    path?: string;
  };
  logging?: {
    level?: string;
  };
  features?: {
    hil_enabled?: boolean;
    max_concurrent_agents?: number;
    cors_origin?: string;
  };
}

export interface AppConfig {
  podeletDir: string;
  dbName: string;
  llmApiUrl: string;
  appPort: number;
  enableWatchers: boolean;
  safemode: boolean;
  pythonPort: number;
  webPort: number;
  logLevel: string;
  maxConcurrentAgents: number;
  corsOrigin: string;
  host: string;
}
