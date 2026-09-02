<p align="center">
  <img src="podlet-logo.png" width="180" alt="Podlet logo" />
</p>

# Podlet

*Modular AI Agent Orchestration System — a self-hosted gateway for orchestrating specialized agents, tools, and skills.*

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Runtime](https://img.shields.io/badge/runtime-Bun-000000)
![Docker](https://img.shields.io/badge/docker-supported-2496ED?logo=docker&logoColor=white)
![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

---

## What is Podlet?

Podlet runs as a **server on your machine**. It exposes a web UI and an HTTP API, and orchestrates AI agents backed by language models through a Python core (litellm).

- **Server-first** — the gateway, frontend, and agent core run as services on your machine or in Docker.
- **Web UI** — a SolidJS interface for chatting with agents, building new agents, and browsing generated files.
- **Agents** — specialized workers defined as JSON files (model, prompt, skills, tools, sub-agents).
- **Simple install** — one command with Docker, or `bun install && bun run init` from source.

### Table of Contents

**Getting Started** — [Quick Start](#quick-start) · [Docker Configuration](#docker-configuration) · [Architecture](#architecture) · [Configuration](#configuration)

**Agents & Tools** — [Agent Configuration](#agent-configuration) · [Tools System](#tools-system) · [Skills](#skills) · [Human-in-the-Loop](#human-in-the-loop)

**Reference** — [Virtual File System](#virtual-file-system) · [Agent Builder UI](#agent-builder-ui) · [File Drawer](#file-drawer) · [API Reference](#api-reference) · [Frontend](#frontend) · [Security](#security) · [Tech Stack](#tech-stack) · [Contributing](#contributing) · [License](#license)

---

## Quick Start

*Two ways to run Podlet — pick one.*

### From Source

**Prerequisites:** [Bun](https://bun.sh) and Python 3.12.

```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun install
bun run init      # interactive setup
bun run start     # starts all three services
```

Open **http://localhost:3002**.

### With Docker

**Prerequisites:** Docker and Docker Compose.

```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
docker compose up -d
```

Open **http://localhost:3000**.

---

## Docker Configuration

The Docker setup runs two containers from a single `compose.yml`:

| Container | Role |
|---|---|
| `gateway` | API server + web UI (static frontend baked into the image) |
| `agent-core` | Python LLM backend (FastAPI + litellm), internal network only |

Podlet adapts to Docker through two environment variables:

- **`PODLET_DOCKER=1`** — the gateway binds to `0.0.0.0` instead of `127.0.0.1`, so it is reachable through the published port.
- **`LLM_SERVICE_HOST=agent-core`** — the gateway reaches the Python backend at `http://agent-core:8000` (the other container's hostname on the internal network) instead of `127.0.0.1`.

**Where is my data?** Podlet's data lives in `~/.podlet` on the host, bind-mounted into the container at `/root/.podlet`. Nothing is stored inside the containers — config, agents, chat history, and generated files all survive rebuilds and resets.

> [!NOTE]
> **Windows users:** the mount uses `$HOME/.podlet`. In a plain Windows shell `HOME` is often unset — export it (`set HOME=%USERPROFILE%`) before running `docker compose up`.

### Changing the exposed port

The compose file maps the gateway as `3000:3000`. To expose Podlet on a different port on the host, edit that line in `compose.yml` (for example `8080:3000`) and run `docker compose up -d` again.

### Data management

- **Backup** — `cp -r ~/.podlet ~/podlet-backup`
- **Reset** — `rm -rf ~/.podlet && docker compose up -d` (first run re-seeds everything from the image)

> [!CAUTION]
> The reset command deletes **all** Podlet data: agents, prompts, skills, chat history, and API keys. There is no confirmation prompt.

---

## Architecture

| Component | What it does |
|---|---|
| **Gateway** (`apps/gateway`) | Bun + Elysia API server. Serves the web UI in Docker, manages agents and chat history (SQLite), connects to MCP servers, and enforces the file sandbox. |
| **Frontend** (`apps/web`) | SolidJS + Vite app. In Docker it is prebuilt and served by the gateway; natively it runs as a Vite dev server. |
| **Agent Core** (`agent_core_py`) | Python FastAPI service. Streams completions through litellm, which routes to the configured provider (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, ...). |

All three talk over HTTP on your machine (native) or the internal Docker network.

---

## Configuration

*Everything Podlet needs lives in one folder: `~/.podlet/` — created and populated on first run.*

### `config.json`

<details>
<summary>Full default config (click to expand)</summary>

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
  "features": {
    "safemode": false
  }
}
```

</details>

| Field | Type | Default | Effect |
|---|---|---|---|
| `server.port` | number | `3000` | Gateway API port. |
| `server.host` | string | `"127.0.0.1"` | Bind address. Docker forces `0.0.0.0`. |
| `server.pythonPort` | number | `8000` | Python backend port (native). |
| `server.webPort` | number | `3002` | Web UI port (native only). Also derives the CORS origin. |
| `database.path` | string | `"podlet.db"` | SQLite file name inside `~/.podlet`. |
| `features.safemode` | boolean | `false` | Human-in-the-Loop approval for destructive tool calls. |

**Port rules per mode** — the traffic-light version:

| Setting | Native | Docker |
|---|---|---|
| `server.port` | 🟢 adjustable | 🔴 keep at `3000` — the compose mapping targets it |
| `server.pythonPort` | 🟢 adjustable | 🔴 keep at `8000` — agent-core listens there |
| `server.webPort` | 🟢 adjustable | ⚪ no effect — the gateway serves the prebuilt bundle |
| `server.host` | 🟢 adjustable | 🔵 forced to `0.0.0.0` by `PODLET_DOCKER` |

Visual cheat-sheet (colors, not literal JSON):

```diff
  "server": {
-   "port": 3000        Docker: leave it — compose maps 3000:3000
-   "pythonPort": 8000  Docker: leave it — agent-core listens on 8000
+   "webPort": 3002     Native: change freely — ignored under Docker
  }
```

> [!WARNING]
> Under Docker, changing `server.port` or `server.pythonPort` in `config.json` breaks the app silently — the compose mapping and the agent-core image depend on the fixed values. Use the compose port line to change the exposed port instead.

> [!TIP]
> Older `config.json` files may contain extra keys (`logging`, `cors_origin`, `exposedPort`). Nothing reads them — safe to delete.

### `.env`

API keys live in `~/.podlet/.env`, one per provider (`OPENAI_API_KEY=...`, `ANTHROPIC_API_KEY=...`, ...). The Python core reads this file on every request — edits apply without restarting.

### `models.json`

Maps the model ids used by agents to actual provider models:

```json
{
  "fast": { "provider": "openrouter", "model": "zai/glm-4.6", "api_key_name": "OPENROUTER_API_KEY" },
  "smart": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "api_key_name": "ANTHROPIC_API_KEY" }
}
```

### `mcp.json`

Declares MCP servers; the default set ships `context7` (documentation lookups) and `ddg-search` (web search).

---

## Agent Configuration

Agents are JSON files in `~/.podlet/agents/`, loaded at gateway start.

<details>
<summary>Example agent file (click to expand)</summary>

```json
{
  "agentId": "backend-architect",
  "agentDescription": "Designs API contracts, data models, and service boundaries.",
  "model": "smart",
  "system_prompt": "backend_architect.md",
  "mcps": [],
  "skills": ["api-and-interface-design"],
  "subAgents": []
}
```

</details>

> [!IMPORTANT]
> **Agent ids are identifiers, not labels.** Allowed: letters (any case), digits, `-` and `_`, 1–58 characters. The id becomes the delegation tool name (`agent_<id>`), so spaces break tool calls — and invalid ids are rejected at load with a warning in the gateway logs.

---

## Tools System

*Agents act through three layers: built-in tools, MCP servers, and the file sandbox.*

**Core tools** — `createfile`, `editcode`, `create_directory`, `list_files`, `read_file`, `runinshell`, `search_files`, `refactor`, `refactor_edit`, `deletefile`, `movefile`, `initiate_chat`, `runagent_prompt`, `write_in_artifacts`, `update_task_plan`, `task_details`, `update_task_planagent`, `request_more_details`, `mark_task_complete`.

**MCP servers** — additional tool sources declared in `mcp.json`; the default set ships `context7` and `ddg-search`.

**Output directory** — each agent declares where it may *create* files; only `refactor` / `refactor_edit` may edit existing files anywhere in the sandbox.

**Allowlists** — `skills`, `subAgents`, and `mcps` are opt-in lists per agent: undefined means *none*, keeping each agent's surface minimal.

---

## Skills

Skills are instruction sets in `~/.podlet/skills/`, seeded on first run from the bundled `.podlet/skills/` set. A file watcher reloads them automatically — no restart needed.

---

## Human-in-the-Loop

With `features.safemode: true`, destructive tool calls (file deletion, shell commands) pause and request approval in the UI before executing. Approve or reject each request; nothing runs without you.

---

## Virtual File System

Every chat run gets two sandboxed directories under `~/.podlet/`:

| Directory | Purpose | Access |
|---|---|---|
| `workspace/<runId>/` | Your uploaded files | Read-only for agents |
| `artifacts/<runId>/` | Agent-generated output | Writable, per-agent subdirectories |

Agents cannot touch anything outside these roots or the skills folder.

---

## Agent Builder UI

Create and edit agents without touching JSON: the builder writes to `~/.podlet/agents/` through the gateway API. New agents get auto-unique ids (`new-agent`, `new-agent-2`, ...); rename from the detail view header.

---

## File Drawer

Browse the files of every run — uploads and artifacts — directly from the UI's side drawer.

---

## API Reference

*One endpoint drives everything.*

**`POST /chat/stream`** — streams an agent conversation. Message objects carry `role` and `content`; the stream emits `keepalive` and `ping` events to hold the connection open.

<details>
<summary>Request body example (click to expand)</summary>

```json
{
  "agentId": "main-orchestrator",
  "messages": [
    { "role": "user", "content": "Build me a REST API for a todo app" }
  ]
}
```

</details>

---

## Frontend

SolidJS + Vite. Under Docker the prebuilt bundle is served by the gateway itself (same origin, no CORS); natively Vite serves it on `server.webPort`.

---

## Security

- **CORS** — the allowed origin is derived from `server.webPort` (`http://localhost:<webPort>`); it is not separately configurable.
- **History** — `podlet.db` is stored in `~/.podlet`, never inside a container.
- **Abuse guard** — the `openai-gpt-4o` detector defaults to a maximum of 4 requests.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Gateway | Bun, Elysia, Drizzle ORM + SQLite, MCP TypeScript SDK, Zod |
| Agent Core | Python 3.12, FastAPI, litellm, uvicorn, python-dotenv |
| Frontend | SolidJS, Vite |

---

## Contributing

Follow the commit style: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. See [AGENTS.md](AGENTS.md) for architecture notes.

---

## License

MIT — see [LICENSE](LICENSE).
