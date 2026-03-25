import { AgentClient } from "./agent_client";
import { createDB } from "./db/db";
import { FrameCRUDClient } from "./db/db_client";
import { AgentOrchestrator } from "./orchestrator";
import AgentsManager from "./system/agents";
import ModelsManager from "./system/models";
import SkillsManager from "./system/skills";
import MCPManager from "./tools/mcp/client";
import { AppConfig } from "./types";
import { join } from "path";
import { watch, FSWatcher } from 'fs'
import createfilesystem from "./system/files";
import { AgentToolManager } from "./tools/agents-as-tools";

export default class AppContainer {
  frameCRUD: FrameCRUDClient;
  agentClient: AgentClient;
  mcpManager: MCPManager;
  modelManager: ModelsManager
  skillManager: SkillsManager;
  orchestrator: AgentOrchestrator;
  agentManager: AgentsManager;
  initConfig: AppConfig;
  agentToolsManager: AgentToolManager
  private watchers: FSWatcher[] = [];

  constructor(appconfig: AppConfig) {
    this.initConfig = appconfig
    const db = createDB(appconfig.podeletDir, appconfig.dbName)
    this.frameCRUD = new FrameCRUDClient(db)
    this.mcpManager = new MCPManager(appconfig.podeletDir)
    this.modelManager = new ModelsManager(appconfig.podeletDir)
    this.skillManager = new SkillsManager(appconfig.podeletDir)
    this.agentManager = new AgentsManager(appconfig.podeletDir)
    this.agentToolsManager = new AgentToolManager(this)
    this.agentClient = new AgentClient(this)
    this.orchestrator = new AgentOrchestrator(this)
  }

  async init() {
    await createfilesystem(this.initConfig.podeletDir)

    await this.mcpManager.init()
    await this.skillManager.LoadSkillsDefs()
    await this.modelManager.init()
    await this.agentManager.loadAll()

    if (this.initConfig.enableWatchers) { await this.startwatchers() }
  }

  private async startwatchers() {
    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'skills'), { recursive: true },
        async () => await this.skillManager.LoadSkillsDefs())
    );

    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'models.json'),
        async () => await this.modelManager.init())
    );

    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'mcp.json'),
        async () => await this.mcpManager.init())
    );

    this.watchers.push(
      watch(join(this.initConfig.podeletDir, 'agents'), { recursive: true },
        async () => await this.agentManager.loadAll())
    );
  }

  async cleanup() {
    this.watchers.forEach(w => w.close());
    await this.mcpManager.stopAll();
  }


}
