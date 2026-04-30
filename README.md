<img src="podlet-logo.png" width="200" />

# Podlet

**Modular AI Agent Orchestration System**

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black)](https://bun.sh)
[![Python](https://img.shields.io/badge/Backend-Python%203.10+-blue)](https://www.python.org)

## What is Podlet?

Podlet is a high-performance, modular orchestration system designed to manage complex AI agent workflows. By combining a fast TypeScript gateway, a flexible Python LLM backend, and a reactive SolidJS frontend, Podlet enables the creation of specialized agents that can collaborate, use external tools via MCP (Model Context Protocol), and operate within a secure virtual filesystem.

## Architecture

```text
       [ User Interface ] <------> [ Gateway (Elysia/Bun) ] <------> [ Python Backend (FastAPI) ]
       (SolidJS / Web)             (Orchestrator & API)              (LiteLLM / Streaming)
                                            |                                  |
                                            v                                  v
                                    [ Virtual FS ]                      [ LLM Providers ]
                                    (Workspace/Artifacts)               (OpenRouter, OpenAI, 
                                                                        Ollama, Gemini, etc.)
                                            |
                                            +------> [ MCP Servers ]
                                                     (Search, Context, etc.)
```

## Quick Start

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.ps1 | iex
```

## Manual Setup

### Prerequisites

- **Bun runtime** (latest)
- **Python 3.10+**
- **Git**

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/HellKaiser45/Podlet.git
   cd Podlet
   ```

2. **Initialize the system**

   ```bash
   bun run init
   ```

   *This interactive wizard checks prerequisites, installs dependencies, and helps you configure your environment.*
3. **Start all services**

   ```bash
   bun run start
   ```

**Other available scripts:**

- `bun run start:gateway` — Launch only the Gateway.
- `bun run start:python` — Launch only the Python backend.

## Configuration

Podlet uses a dedicated configuration directory located at `~/.podlet/` (referenced as `podeletDir` in code).

| File | Description |
| :--- | :--- |
| `config.json` | Global server settings. See full schema below. |
| `models.json` | LLM definitions including provider, model ID, API key reference, and temperature. |
| `mcp.json` | Configuration for MCP servers (commands, arguments, and environment variables). |
| `.env` | Environment variables for API keys (e.g., `OPENROUTER_API_KEY`). |
| `agents/*.json` | Individual agent definitions and capabilities. |
| `prompts/*.md` | System prompts for agents. |
| `skills/` | Directories containing skill modules (documented in `SKILL.md`). |

### config.json Schema

```json
{
  "server": {
    "port": 3000,
    "host": "127.0.0.1",
    "pythonPort": 8000,
    "webPort": 3002
  },
  "database": {
    "path": "podlet.db"
  },
  "logging": {
    "level": "info"
  },
  "features": {
    "safemode": true,
    "max_concurrent_agents": 5,
    "cors_origin": "http://localhost:3002"
  }
}
```

| Field | Description |
| :--- | :--- |
| `server.port` | Gateway API port. |
| `server.host` | Bind address for the gateway. |
| `server.pythonPort` | Port for the internal Python LLM backend. |
| `server.webPort` | Port for the SolidJS web frontend. |
| `database.path` | SQLite database file path (relative to `~/.podlet/`). |
| `logging.level` | Log verbosity (`debug`, `info`, `warn`, `error`). |
| `features.safemode` | Enable Human-in-the-Loop (HIL) approval for destructive tools. |
| `features.max_concurrent_agents` | Maximum number of simultaneous agent runs. |
| `features.cors_origin` | Allowed CORS origin for the frontend. |

## Agents

Agents are the core units of Podlet. They are defined in `~/.podlet/agents/*.json`.

### Agent Schema

```json
{
  "agentId": "string",
  "agentDescription": "string",
  "model": "string (key from models.json)",
  "system_prompt": "string (filename in prompts/)",
  "mcps": ["mcpId1", "mcpId2"],
  "skills": ["skill-name1", "skill-name2"],
  "subAgents": ["agentId1", "agentId2"]
}
```

### Seed Agents

Podlet comes with a set of pre-configured agents:

- **PODLET Main Orchestrator**: The primary entry point for complex tasks.
- **Coder**: Specialized in writing and refining code.
- **Frontend Architect / Coder**: Handles UI design and implementation.
- **Backend Architect**: Designs API and database structures.
- **Code Reviewer**: Analyzes code for quality and bugs.
- **Documentation Master**: Creates professional technical docs.
- **Asset Creator**: Manages visual/multimedia assets.
- **Frontend Reviewer**: Audits UI/UX implementation.

## Tools System

Agents have access to three categories of tools:

1. **Core Tools**: Built-in capabilities like `read_file` and `execute_shell` (sandboxed).
2. **MCP Tools**: Tools provided by MCP servers defined in `mcp.json` (e.g., `ddg-search_search`).
3. **Sub-agent Tools**: Other agents can be called as tools using the `agent_` prefix (e.g., `agent_Coder`).

## Skills

Skills are reusable modules that extend an agent's capabilities. They are stored in the `skills/` directory and consist of a folder containing a `SKILL.md` file along with optional scripts, references, and templates.

Podlet uses a **progressive disclosure** strategy to keep context windows efficient:

- **Tier 1 — Catalog**: At session start, every skill's name, description, and directory structure are injected into the system prompt so the model knows what is available.
- **Tier 2 — SKILL.md**: When a skill is relevant to the task, the model reads its full `SKILL.md` via the `read_file` tool.
- **Tier 3 — Assets**: Scripts, references, and templates are loaded on demand only when the skill explicitly instructs the model to use them.

Behavioral instructions in the system prompt encourage the model to proactively read skills when it detects a matching domain. Each agent can scope its own set of skills via the `skills` array in its JSON definition. For cross-client compatibility, skill configurations gracefully fall back to a safe default if the YAML is malformed.

## Human-in-the-Loop (HIL)

To prevent unauthorized actions, Podlet includes a **safemode** that is now fully wired through the frontend.

- When `safemode` is enabled, the agent loop is monitored for destructive tool calls.
- If an approval is required, the stream emits a `CUSTOM` event with the name `AWAITING_APPROVAL`.
- The frontend renders an **ApprovalPanel** showing each pending tool call with its arguments.
- The user can **Approve** or **Reject** each call individually and optionally provide feedback.
- After all decisions are collected, the agent loop resumes automatically.

## Token Limits

Podlet implements token budgeting on both the frontend and backend to prevent context-window overflows and unnecessary API costs.

**Frontend**

- Before sending a message, the UI estimates token usage:
  - Text: `characters / 4`
  - Images: `width * height / 750`
- If the estimated total exceeds **50,000 tokens**, the message is rejected immediately with an inline error.

**Backend**

- The gateway computes the full token budget: system prompt + injected skills + file tree + conversation history + user message.
- This total is checked against the model's `context_window` defined in `models.json` (default: **128,000**).
- If the budget is exceeded, a `TokenLimitError` is raised and emitted as a `RUN_ERROR` SSE event with code `TOKEN_LIMIT_EXCEEDED`.

## Virtual Filesystem (VFS)

Agents operate in a secure sandbox using a scheme-based VFS:

- `workspace://` : Read-only access to input files.
- `artifacts://` : Write access for output files.
- `skills://` : Access to skill-specific resources (restricted to agents possessing the skill).

Real paths are mapped to `~/.podlet/workspace/{runId}/` and `~/.podlet/artifacts/{runId}/`.

## Agent Builder

The **Agent Builder** is the default landing page at `/`. It provides a master-detail layout for managing agents without editing JSON by hand.

- **Agent Roster** (left): A scrollable list of all agents with inline search.
- **Agent Detail** (right): A full editor for the selected agent.
  - Create, edit, and delete agents inline.
  - **Model selector** dropdown tied to `models.json`.
  - **Multi-select tag pickers** for Skills, MCPs, and Sub-agents.
  - **Prompt editor** to view, edit, create, and delete system prompts stored in `prompts/`.
- **INITIATE** button deploys the selected agent directly into the chat interface.
- **Responsive layout**: Side-by-side on desktop, stacked on mobile.

## File Drawer

The File Drawer is accessible from the chat interface and provides a full-featured file explorer for the current run.

- **Hierarchical file tree** with expand/collapse folders.
- **Search/filter bar** to quickly locate files.
- **Click-to-select** with a preview panel on the right.
  - Code highlighting for source files.
  - Markdown rendering.
  - Image preview.
  - Edit mode for text files.
- **Download** individual files or entire folders as a ZIP archive.
- **Tabs** to switch between `workspace` (read-only inputs) and `artifacts` (agent outputs).

## API Reference

Base URL: `http://localhost:3000/api` | Interactive Docs: `/api/openapi`

### Chat

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/chat` | SSE stream for agent interaction. |
| `GET` | `/history/:runid` | Retrieve history for a specific run. |
| `GET` | `/runids` | List all session run IDs. |
| `PATCH` | `/history/label/:runid` | Label a specific run. |
| `DELETE` | `/chat/:runid` | Purge history and VFS for a run. |

### Agents

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/agents/all` | List all defined agents. |
| `GET` | `/agents/:agentId` | Get specific agent details. |
| `GET` | `/agents/:agentId/prompt` | Get the agent's prompt content. |
| `GET` | `/agents/prompts/list` | List all prompt filenames. |
| `POST` | `/agents` | Create a new agent (body: Agent JSON). |
| `PUT` | `/agents/:agentId` | Update an agent (body: partial Agent JSON). |
| `DELETE` | `/agents/:agentId` | Delete an agent. |

### Models

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/models/all` | List all configured LLM models. |
| `GET` | `/models/:name` | Get a specific model configuration. |
| `POST` | `/models` | Create a model (body: `{ name, config }`). |
| `PUT` | `/models/:name` | Update a model (body: partial config). |
| `DELETE` | `/models/:name` | Delete a model. |

### MCPs

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/mcps/all` | List all MCP configurations. |
| `GET` | `/mcps/running` | List running MCP instances. |
| `GET` | `/mcps/:name` | Get a specific MCP configuration. |
| `POST` | `/mcps` | Create an MCP (body: `{ name, config }`). |
| `PUT` | `/mcps/:name` | Update an MCP (body: partial config). |
| `DELETE` | `/mcps/:name` | Delete an MCP (stops it if running). |
| `POST` | `/mcps/:name/start` | Start the MCP server. |
| `POST` | `/mcps/:name/stop` | Stop the MCP server. |

### Prompts

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/prompts/all` | List all prompt filenames. |
| `GET` | `/prompts/:name` | Get a specific prompt's content. |
| `POST` | `/prompts` | Create a prompt (body: `{ name, content }`). |
| `PUT` | `/prompts/:name` | Update a prompt (body: `{ content }`). |
| `DELETE` | `/prompts/:name` | Delete a prompt. |

### Skills

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/skills/all` | List all available skills. |

### Files

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/file/upload` | Upload files to a run. |
| `GET` | `/file/:runid/:fileid` | Read file content. |
| `GET` | `/file/download/:runid/:fileid` | Download a file. |
| `GET` | `/file/download-zip/:runid/:folderid` | Download a folder as a ZIP archive. |
| `GET` | `/file/all/:runid` | List all files for a run. |

### Python Backend (Internal)

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `http://localhost:8000/chat/stream` | LLM streaming completions. |

## SSE Events

The chat endpoint streams events over SSE. Clients should handle the following event types:

| Event | Description |
| :--- | :--- |
| `RUN_STARTED` | Emitted when an agent run begins. |
| `RUN_FINISHED` | Emitted when an agent run completes. Payload includes the final `result` with `status`. |
| `CUSTOM` | Custom application events. Currently used for `AWAITING_APPROVAL` during HIL. |
| `RUN_ERROR` | Emitted on unrecoverable errors. Payload includes `message` and `code` (e.g., `TOKEN_LIMIT_EXCEEDED`). |

## Frontend

The web UI is accessible at `http://localhost:3002` by default but can be configured in `~/.podlet/config.json`.

- **Thread Management**: Sidebar for organizing conversations.
- **Streaming UI**: Real-time responses with typing indicators.
- **Agent HUD**: Overview of agent statuses and configurations.
- **Styling**: DaisyUI Catppuccin Mocha theme.

## Tech Stack

| Component | Technology |
| :--- | :--- |
| **Runtime** | Bun (TypeScript) |
| **Gateway** | Elysia.js |
| **LLM Backend** | Python FastAPI + LiteLLM |
| **Frontend** | SolidJS + Vite + Tailwind CSS + DaisyUI |
| **Database** | SQLite (Drizzle ORM) |
| **Protocols** | MCP, AG-UI, SSE |

## Roadmap

### Completed

- [x] **HIL Frontend** — ApprovalPanel with approve/reject per tool.
- [x] **Full CRUD API** — Agents, Models, MCPs, Prompts.
- [x] **Agent Builder** — Master-detail UI at `/`.
- [x] **File Tree** — Hierarchical explorer with search and download.
- [x] **Token Guards** — Frontend pre-check + backend budget check.

### v0.2 — Upcoming

- [ ] **CLI Tool** — Terminal-based alternative to the web UI.
- [ ] **Tool Isolation** — Enhanced sandboxing and stricter VFS boundaries.

### v0.3 — Planned

- [ ] **Full VFS Isolation** — Chroot-like sandboxing with zero escape vectors.
- [ ] **Docker Deployment** — `docker-compose` for production-ready setup.
- [ ] **Versioned Config** — Migration system for configuration upgrades.
- [ ] **History Compaction** — Automatic summarization of long conversations.

### v0.4 — Considered

- [ ] **Memory Management** — Summarization and RAG-based long-term recall.
- [ ] **Shared History** — Better context passing between parent and sub-agents.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
