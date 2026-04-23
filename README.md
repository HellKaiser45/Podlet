<img src="podlet-logo.png" width="200" />

# Podlet

> An intelligent agent orchestration system with multi-agent workflows, tool sandboxing, and human-in-the-loop oversight.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![Python](https://img.shields.io/badge/python-3.10+-blue)](https://python.org)
[![SolidJS](https://img.shields.io/badge/frontend-SolidJS-blue)](https://solidjs.com)

## What is Podlet

Podlet is a modular AI agent operator. Agents are stateless — they live and die per conversation run. The system orchestrates multi-agent workflows where a main orchestrator agent dispatches tasks to specialized sub-agents (Coder, Frontend Architect, Backend Architect, Code Reviewer, etc.). Each agent has its own LLM model, system prompt, tools, skills, and sub-agents. The system supports:
- **Multi-provider LLM** via LiteLLM (OpenAI, Anthropic, OpenRouter, Gemini, Ollama, custom endpoints)
- **MCP (Model Context Protocol)** for external tool integration
- **Skills** — YAML-frontmatter modules injected into agent prompts
- **Human-in-the-loop** approval for sensitive tool calls
- **Virtual Filesystem** — sandboxed file operations with `/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db` and `/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db` schemes
- **SSE streaming** following AG-UI event specifications

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Podlet Architecture                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐    SSE/REST    ┌─────────────────────┐  │
│  │  Web UI      │◄─────────────►│  Gateway (Elysia)    │  │
│  │  SolidJS     │  localhost:3002│  localhost:3000      │  │
│  │  port 3002   │◄──proxy──────►│                      │  │
│  └─────────────┘               │  ┌────────────────┐  │  │
│                                │  │ Orchestrator    │  │  │
│                                │  │ Agent Loop      │  │  │
│                                │  │ HIL Manager     │  │  │
│                                │  │ VFS Sandbox     │  │  │
│                                │  │ MCP Client      │  │  │
│                                │  │ Skills Manager   │  │  │
│                                │  └────────────────┘  │  │
│                                │         │             │  │
│                                │    SSE/HTTP           │  │
│                                │         ▼             │  │
│                                │  ┌────────────────┐  │  │
│                                │  │ Python Backend   │  │  │
│                                │  │ FastAPI+LiteLLM  │  │  │
│                                │  │ localhost:8000   │  │  │
│                                │  └────────────────┘  │  │
│                                └─────────────────────┘  │
│                                         │               │
│                                         ▼               │
│                                ┌─────────────────┐     │
│                                │  ~/.podlet/       │     │
│                                │  config.json      │     │
│                                │  models.json      │     │
│                                │  mcp.json         │     │
│                                │  .env (keys)      │     │
│                                │  agents/*.json    │     │
│                                │  prompts/*.md     │     │
│                                │  skills/          │     │
│                                │  SQLite DB        │     │
│                                └─────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.ps1 | iex

# Manual setup
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun run init     # Interactive setup wizard
bun run start    # Launch all services
```

## Manual Setup

Prerequisites:
- **Bun** >= 1.0 — https://bun.sh
- **Python** >= 3.10 — https://python.org
- **Git** — https://git-scm.com

Steps:
```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun install
python3 -m venv agent_core_py/.venv
source agent_core_py/.venv/bin/activate  # Windows: agent_core_py\\.venv\\Scripts\\activate
pip install -r agent_core_py/requirements.txt
bun run init
```

Available scripts:
| Command | Description |
|---|---|
| `bun run init` | Interactive setup wizard (prerequisites check, dependency install, config generation) |
| `bun run start` | Start all services (gateway + python + web UI) |
| `bun run start:gateway` | Start only the Elysia gateway |
| `bun run start:python` | Start only the Python LLM backend |
| `bun run dev:gateway` | Start gateway in watch mode |
| `bun run dev:web` | Start web UI in dev mode |

## Configuration

All runtime configuration lives in `~/.podlet/`:

```
~/.podlet/
├── config.json        # Server settings (port, host, features)
├── models.json        # LLM model definitions
├── mcp.json           # MCP server definitions
├── .env               # API keys
├── agents/            # Agent definitions (*.json)
│   ├── code_architect.json
│   ├── coder_agent.json
│   └── ...
├── prompts/           # Agent system prompts (*.md)
│   ├── code_architect.md
│   ├── coder_agent.md
│   └── ...
└── skills/            # Skill modules (each with SKILL.md)
    ├── idea-refine/
    ├── planning-and-task-breakdown/
    └── ...
```

#### config.json
```json
{
  "server": { "port": 3000, "host": "127.0.0.1", "cors_enabled": true },
  "database": { "path": "podlet.db" },
  "logging": { "level": "info" },
  "features": { "hil_enabled": true, "max_concurrent_agents": 5 }
}
```

#### models.json
Each key is a model alias used in agent definitions:
```json
{
  "fast": {
    "provider": "openrouter",
    "model": "google/gemma-4-31b-it"
  },
  "smart": {
    "provider": "zai",
    "model": "GLM-5.1",
    "base_url": "https://api.z.ai/api/coding/paas/v4"
  },
  "local-llama": {
    "provider": "openai",
    "model": "llama3.2",
    "base_url": "http://localhost:11434/v1",
    "api_key": "ollama"
  }
}
```
Fields: `provider` (required), `model` (required), `api_key_name` (env var name for the API key), `temperature`, `max_tokens`, `base_url` (for custom endpoints).

Supported providers: openai, anthropic, openrouter, gemini, ollama, or any LiteLLM-compatible provider.

#### mcp.json
```json
{
  "mcpServers": {
    "ddg-search": {
      "command": "uvx",
      "args": ["duckduckgo-mcp-server"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

#### .env
```
OPENROUTER_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
ZAI_API_KEY=...
```

## Agents

#### Agent Definition Schema
```json
{
  "agentId": "unique-agent-name",
  "agentDescription": "What this agent does",
  "model": "fast",              // Key from models.json
  "system_prompt": "prompt.md", // Filename in prompts/
  "mcps": ["context7"],         // Optional: MCP server IDs
  "skills": ["idea-refine"],    // Optional: Skill names
  "subAgents": ["Coder"],       // Optional: Other agentIds to use as tools
  "response_format": {}         // Optional: Force output format
}
```

#### Creating an Agent

1. Create a JSON file in `~/.podlet/agents/your-agent.json`
2. Create a markdown prompt in `~/.podlet/prompts/your-prompt.md`
3. Set `"system_prompt"` in the JSON to the prompt filename
4. If watchers are enabled, the agent is loaded automatically. Otherwise restart the gateway.

Example — a simple code reviewer:
```json
// ~/.podlet/agents/reviewer.json
{
  "agentId": "Reviewer",
  "agentDescription": "Reviews code for bugs, security issues, and best practices",
  "model": "fast",
  "system_prompt": "reviewer.md",
  "mcps": ["context7"]
}
```

#### Sub-Agents (A2A Pattern)

Agents can delegate to other agents via the `subAgents` field. Sub-agents appear as tools named `agent_{agentId}`. When a parent agent calls a sub-agent tool, the orchestrator creates a child frame, runs the sub-agent's loop, and returns the result to the parent's tool call. The parent is suspended while the child runs.

#### Seed Agents

The init script seeds these default agents:
| Agent | Model | Description |
|---|---|---|
| PODLET Main Orchestrator | smart | Head architect, plans and delegates |
| Coder | fast | Executes coding tasks |
| PODLET Frontend Architect Agent | smart | Frontend design expert |
| PODLET Backend Architect Agent | smart | API and service design |
| PODLET Code Reviewer Agent | fast | Code review and quality |
| Documentation Master Agent | fast | Document creation and writing |
| PODLET Frontend Coder Agent | fast | Frontend implementation |
| Asset Creator Agent | fast | Creates visual assets |
| Frontend Reviewer Agent | fast | Frontend code review |

## Tools System

Agents have access to three types of tools:

**Core Tools** (always available):
- `read_file` — Read one or more files from the VFS
- `execute_shell` — Execute bash commands in the sandbox (30s timeout, max 300s)

**MCP Tools** (from configured MCP servers):
- Tools are prefixed: `{mcpId}_{toolName}` (e.g., `ddg-search_search`, `context7_query-docs`)
- Started on-demand when an agent references them in its `mcps` list

**Sub-Agent Tools** (from configured sub-agents):
- Tools are prefixed: `agent_{agentId}` (e.g., `agent_Coder`)
- Parameters: `task` (required), `previous_action_summary`, `workspace_path`, `relevant_files`

## Skills

Skills are YAML-frontmatter modules stored in `~/.podlet/skills/`. Each skill has a `SKILL.md` file:

```markdown
---
name: my-skill
description: What this skill does
---

Skill instructions and references go here.
```

When an agent has skills configured, they are injected into the system prompt as XML blocks:
```xml
<available_skills>
<skill>
<name>my-skill</name>
<description>...</description>
<location>/home/hellkaiser/.podlet/skillsmy-skill/SKILL.md</location>
</skill>
</available_skills>
```

Agents can then read the SKILL.md file to get instructions.

## Human-in-the-Loop (HIL)

When HIL is enabled (config `features.hil_enabled` or `safemode`), the system intercepts tool calls that match editing keywords (write, edit, create, delete, execute, shell, etc.) and suspends execution.

**Flow:**
1. Agent calls a sensitive tool
2. HIL Manager flags the tool call as `pending`
3. Frame is saved to database with `status: "suspended"`
4. SSE event `AWAITING_APPROVAL` is sent to the frontend
5. User sends approve/reject decision via `POST /api/chat` with `decision` field
6. Orchestrator resumes the agent loop

**Decision format:**
```json
{
  "toolCallId": {
    "approved": true,
    "feedback": "optional feedback if rejected"
  }
}
```

## Virtual Filesystem (VFS)

Agents operate in a sandboxed virtual filesystem with three schemes:

| Scheme | Purpose | Read | Write |
|---|---|---|---|
| `/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db` | User input files | Yes | No (read-only) |
| `/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db` | Agent output files | Yes | Yes |
| `/home/hellkaiser/.podlet/skills` | Skill resources | Yes | No |

Real paths are resolved to `~/.podlet/workspace/{runId}/` and `~/.podlet/artifacts/{runId}/`. The VFS blocks:
- Path traversal (`..`)
- Absolute paths outside sandbox
- URLs
- Unauthorized scheme access

## API Reference

All API routes are prefixed with `/api`. Interactive docs at `http://localhost:3000/api/openapi`.

| Method | Path | Description |
|---|---|---|
| POST | /api/chat | Start/resume agent execution (SSE stream) |
| GET | /api/history/:runid | Get message history |
| GET | /api/runids | List all run IDs |
| PATCH | /api/history/label/:runid | Set a label for a run |
| DELETE | /api/chat/:runid | Delete history and VFS for a run |
| GET | /api/agents/all | List all agents |
| GET | /api/agents/:agentId | Get specific agent definition |
| GET | /api/models/all | List all model configs |
| GET | /api/mcps/all | List all MCP configs |
| GET | /api/mcps/running | List running MCP instances |
| POST | /api/file/upload | Upload files (multipart) |
| GET | /api/file/download/:runid/:fileid | Download a file |
| GET | /api/file/:runid/:fileid | Read file text content |
| GET | /api/file/all/:runid | List all files for a run |
| DELETE | /api/file/:runid/:fileid | Delete a file |
| PATCH | /api/file/:runid/:fileid | Update file content |

Python backend at `http://localhost:8000`:
| POST | /chat/stream | SSE streaming LLM completion |

## Frontend

The web UI runs on `http://localhost:3002` and provides:
- Thread-based conversations
- Real-time SSE streaming with typing indicators
- File upload and attachment support
- Agent selection
- Conversation history sidebar
- Dark theme (Catppuccin Mocha via DaisyUI)

## Tech Stack

| Component | Technology |
|---|---|
| Gateway Runtime | Bun |
| Gateway Framework | Elysia.js |
| LLM Backend | Python FastAPI + LiteLLM |
| Frontend | SolidJS |
| Frontend Build | Vite |
| Styling | Tailwind CSS + DaisyUI |
| Database | SQLite (Drizzle ORM) |
| API Client | @elysiajs/eden |
| Agent Events | AG-UI (SSE) |
| Tool Protocol | MCP |
| Package Manager | Bun (monorepo workspaces) |

## Roadmap

### v0.2 — Upcoming
- [ ] **CLI Tool** — Terminal-based alternative to the web UI for headless/terminal usage
- [ ] **HIL Overhaul** — Fix the current human-in-the-loop implementation: reliable suspension/resume, per-agent/per-tool approval config, UI integration improvements
- [ ] **Enhanced Tool Isolation** — Stricter sandboxing, rate limiting, and guardrails for tool execution

### v0.3 — Planned
- [ ] **Full VFS Isolation** — Complete virtual filesystem with no escape vectors, chroot-like sandboxing
- [ ] **Docker Deployment** — Containerized setup with docker-compose for production
- [ ] **Versioned Configuration** — Migration system for config files between versions

### v0.4 — Considered
- [ ] **Memory Management System** — Long conversation handling: conversation summarization, sliding window context, RAG-based long-term memory recall
- [ ] **Sub-Agent Message History** — Shared message history between parent and child agents for richer context passing and debugging

## Contributing
Contributions are welcome. Fork the repo, create a feature branch, and open a pull request.

## License
This project is licensed under the terms specified in the [LICENSE](LICENSE) file.
