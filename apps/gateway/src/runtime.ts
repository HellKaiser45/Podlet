import { AgentClient } from "./agent_client";
import { createDB } from "./db/db";
import { FrameCRUDClient } from "./db/db_client";
import { AgentOrchestrator } from "./orchestrator";
import AgentsManager from "./system/agents";
import ModelsManager from "./system/models";
import SkillsManager from "./system/skills";
import MCPManager from "./tools/mcp/client";
import { AppConfig } from '@podlet/types';
import { join } from "path";
import { watch, FSWatcher } from 'fs'
import createfilesystem from "./system/files";
import { AgentToolManager } from "./tools/agents-as-tools";
import { AgentEventStream } from "./stream_handler";
import { HilManager } from "./hil/hil-manager";
import { HistoryCRUDClient } from "./db/db_history_client";
import PromptsManager from "./system/prompts";

export default class AppContainer {
  frameCRUD: FrameCRUDClient;
  agentClient: AgentClient;
  mcpManager: MCPManager;
  modelManager: ModelsManager
  skillManager: SkillsManager;
  orchestrator: AgentOrchestrator;
  hillManager: HilManager;
  agentManager: AgentsManager;
  promptManager: PromptsManager;
  initConfig: AppConfig;
  agentToolsManager: AgentToolManager;
  historyManager: HistoryCRUDClient;
  eventManager: Record<string, AgentEventStream> = {}
  private watchers: FSWatcher[] = [];

  constructor(appconfig: AppConfig) {
    this.initConfig = appconfig
    const db = createDB(appconfig.podeletDir, appconfig.dbName)
    this.frameCRUD = new FrameCRUDClient(db)
    this.historyManager = new HistoryCRUDClient(db)
    this.hillManager = new HilManager(appconfig.safemode)
    this.mcpManager = new MCPManager(appconfig.podeletDir)
    this.modelManager = new ModelsManager(appconfig.podeletDir)
    this.skillManager = new SkillsManager(appconfig.podeletDir)
    this.agentManager = new AgentsManager(appconfig.podeletDir)
    this.promptManager = new PromptsManager(appconfig.podeletDir)
    this.agentToolsManager = new AgentToolManager(this)
    this.agentClient = new AgentClient(this)
    this.orchestrator = new AgentOrchestrator(this)
  }

  async init() {
    await createfilesystem(this.initConfig.podeletDir)

    await Promise.all([
      this.mcpManager.init(),
      this.skillManager.LoadSkillsDefs(),
      this.modelManager.init(),
      this.agentManager.loadAll(),
    ])
    // PromptsManager has no async init needed -- it reads files on-demand

    if (this.initConfig.enableWatchers) { await this.startwatchers() }
  }

  private debounce(key: string, fn: () => Promise<void>, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, ms);
    };
  }

  private async startwatchers() {
    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'skills'), { recursive: true },
        this.debounce('skills', async () => await this.skillManager.LoadSkillsDefs(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'models.json'),
        this.debounce('models', async () => await this.modelManager.init(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'mcp.json'),
        this.debounce('mcps', async () => await this.mcpManager.init(), 500))
    );

    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'agents'), { recursive: true },
        this.debounce('agents', async () => await this.agentManager.loadAll(), 500))
    );
  }

  async cleanup() {
    this.watchers.forEach(w => w.close());
    await this.mcpManager.stopAll();
  }
}
