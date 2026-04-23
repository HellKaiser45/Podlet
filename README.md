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
| `config.json` | Global server settings: port, database paths, logging, and feature flags. |
| `models.json` | LLM definitions including provider, model ID, API key reference, and temperature. |
| `mcp.json` | Configuration for MCP servers (commands, arguments, and environment variables). |
| `.env` | Environment variables for API keys (e.g., `OPENROUTER_API_KEY`). |
| `agents/*.json` | Individual agent definitions and capabilities. |
| `prompts/*.md` | System prompts for agents. |
| `skills/` | Directories containing skill modules (documented in `SKILL.md`). |

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

Skills are reusable modules that extend an agent's capabilities. They are stored in the `skills/` directory and consist of a folder containing a `SKILL.md` file. The contents of the skill are injected into the agent's system prompt at runtime.

## Human-in-the-Loop (HIL)

To prevent unauthorized actions, Podlet includes a **safemode**.

- The `HilManager` monitors tool calls for "editing keywords" (e.g., `write`, `edit`, `delete`, `execute`).
- If a match is found, the agent loop is **suspended** (`status: "suspended"`).
- The user is prompted to **Approve** or **Reject** the action (with optional feedback) via the UI before the agent can proceed.

## Virtual Filesystem (VFS)

Agents operate in a secure sandbox using a scheme-based VFS:

- `workspace://` : Read-only access to input files.
- `artifacts://` : Write access for output files.
- `skills://` : Access to skill-specific resources (restricted to agents possessing the skill).

Real paths are mapped to `~/.podlet/workspace/{runId}/` and `~/.podlet/artifacts/{runId}/`.

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

### Agents & Models

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/agents/all` | List all defined agents. |
| `GET` | `/agents/:agentId` | Get specific agent details. |
| `GET` | `/models/all` | List all configured LLM models. |

### MCP & Files

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/mcps/all` | List MCP configurations. |
| `GET` | `/mcps/running` | List active MCP instances. |
| `POST` | `/file/upload` | Upload files to a run. |
| `GET` | `/file/:runid/:fileid` | Read file content. |
| `GET` | `/file/all/:runid` | List all files for a run. |

### Python Backend (Internal)

`POST http://localhost:8000/chat/stream` — Handles LLM streaming completions.

## Frontend

The web UI is accessible at `http://localhost:3002` by default but can be configured in `~/.podlet/config.json`.

- **Thread Management**: Sidebar for organizing conversations.
- **Streaming UI**: Real-time responses with typing indicators.
- **File Drawer**: Easy access to VFS attachments.
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

### v0.2 — Upcoming

- [ ] **CLI Tool** — Terminal-based alternative to the web UI.
- [ ] **HIL Overhaul** — More reliable suspension/resume and per-tool configuration.
- [ ] **Tool Isolation** — Enhanced sandboxing and stricter VFS boundaries.

### v0.3 — Planned

- [ ] **Full VFS Isolation** — Chroot-like sandboxing with zero escape vectors.
- [ ] **Docker Deployment** — `docker-compose` for production-ready setup.
- [ ] **Versioned Config** — Migration system for configuration upgrades.

### v0.4 — Considered

- [ ] **Memory Management** — Summarization and RAG-based long-term recall.
- [ ] **Shared History** — Better context passing between parent and sub-agents.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
