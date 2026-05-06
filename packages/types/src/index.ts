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
  logging?: {
    level?: string;
  };
  features?: {
    safemode?: boolean;
  };
}

export interface AppConfig {
  podeletDir: string;
  dbName: string;
  llmApiUrl: string;
  port: number;
  host: string;
  pythonPort: number;
  webPort: number;
  dbPath: string;
  corsOrigin: string;
  safemode: boolean;
}
