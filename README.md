# Podlet

> An intelligent agent creator system based on state-of-the-art AI protocols including A2A (Agent-to-Agent) and MCP (Model Context Protocol).

## 🚀 Overview

**Podlet** is a cutting-edge agent orchestration and creation system that leverages the latest advances in AI protocols to enable seamless collaboration between intelligent agents. Built on top of the **Agent2Agent (A2A)** protocol and **Model Context Protocol (MCP)**, Podlet provides a powerful gateway for managing, composing, and deploying multiple AI agents in a unified ecosystem.

### Key Concepts

- **Agent Creator System**: Dynamically create, configure, and deploy intelligent agents with custom capabilities
- **A2A Protocol Gateway**: Acts as the central hub for Agent-to-Agent communication, enabling agents to discover, communicate, and collaborate with each other
- **MCP Integration**: Provides agents with rich context and tools through the Model Context Protocol standard
- **Agent Composition**: Orchestrate multiple agents (cagent) to work together on complex tasks
- **Dynamic Lifecycle Management**: Start, stop, and manage agent lifecycles automatically

## 🎯 Features

### A2A Protocol Support

- **Agent Discovery**: Automatically discover and advertise agent capabilities using Agent Cards
- **Task Management**: Handle complex, long-running tasks with real-time status updates
- **Secure Communication**: Enterprise-grade authentication and authorization built-in
- **Cross-Platform Interoperability**: Connect agents built with different frameworks and vendors
- **Multi-Modality Support**: Handle text, audio, video, and other content types

### MCP Integration

- **Universal Tool Access**: Connect agents to external data sources and systems through MCP
- **Context Sharing**: Maintain rich context across agent interactions
- **Standardized Interface**: Leverage the growing ecosystem of MCP servers and tools
- **Enterprise Connectors**: Easy integration with popular platforms (GitHub, Slack, databases, etc.)

### Agent Orchestration

- **Dynamic Agent Creation**: Programmatically create new agents with custom configurations
- **Agent Composition**: Combine multiple agents to solve complex problems
- **Lifecycle Management**: Start, monitor, and stop agents automatically
- **Resource Management**: Efficient handling of agent resources and scaling

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        A2A Gateway                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Agent Discovery & Task Management              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   cAgent 1   │      │   cAgent 2   │      │   cAgent N   │
│  (Creator)   │      │  (Executor)  │      │ (Specialist) │
└──────────────┘      └──────────────┘      └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │    MCP Servers    │
                    │  - Filesystem    │
                    │  - Search        │
                    │  - Context7      │
                    │  - External APIs │
                    └──────────────────┘
```

## 📋 Prerequisites

- **Bun** runtime for the application server
- **Node.js** compatible environment
- Access to AI model providers (OpenAI, or compatible APIs)

## 🛠️ Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/podlet.git
cd podlet

# Install dependencies for the application server
cd app
bun install
```

## 🚀 Getting Started

### Development Mode

```bash
# Start the development server
cd app
bun run dev
```

The server will start on `http://localhost:3000`

### Creating Your First Agent

Podlet uses YAML configuration files to define agents. Here's an example agent definition:

```yaml
agents:
  root:
    model: GLM-model
    description: Readme file expert
    instruction: |
      Generate a high-quality README.md file for a GitHub project
      based on its codebase and project description library and recent researches.
    toolsets:
      - type: filesystem
      - type: mcp
        ref: docker:duckduckgo
      - type: mcp
        ref: docker:context7

models:
  GLM-model:
    provider: openai
    model: GLM-4.7
    base_url: https://api.z.ai/api/coding/paas/v4
    token_key: ZAI_API_KEY
```

## 💡 Usage Examples

### Agent Composition

```typescript
// Create multiple agents that work together
const creatorAgent = new Agent({
  name: "creator",
  role: "task-breakdown",
  capabilities: ["planning", "delegation"]
});

const executorAgent = new Agent({
  name: "executor",
  role: "execution",
  capabilities: ["coding", "testing"]
});

// Orchestrate collaboration
gateway.composeAgents([creatorAgent, executorAgent]);
```

### Task Delegation via A2A

```typescript
// Client agent delegates task to remote agent
const task = await gateway.delegateTask({
  clientAgent: "creator",
  targetAgent: "executor",
  task: {
    description: "Implement user authentication",
    requirements: [...]
  }
});
```

### MCP Tool Integration

```typescript
// Agent uses MCP tools for context
const result = await agent.execute({
  tools: [
    { type: "mcp", ref: "filesystem" },
    { type: "mcp", ref: "duckduckgo" }
  ],
  query: "Research latest A2A protocol developments"
});
```

## 🔧 Configuration

### Gateway Configuration

Configure the A2A gateway in your application settings:

```typescript
// app/src/index.ts
import { Elysia } from "elysia";
import { PodletGateway } from "@podlet/gateway";

const app = new Elysia();

const gateway = new PodletGateway({
  a2a: {
    enableDiscovery: true,
    authentication: "oauth2"
  },
  mcp: {
    servers: [
      "docker:filesystem",
      "docker:duckduckgo",
      "docker:context7"
    ]
  }
});

app.use(gateway.middleware);
```

## 📚 Protocol Specifications

### A2A (Agent-to-Agent) Protocol

The A2A protocol enables secure interoperability between AI agents. Key features:

- **Agent Cards**: JSON-based capability descriptions
- **Task Lifecycle**: End-to-end task management
- **Long-running Operations**: Support for multi-hour/day tasks
- **Real-time Updates**: Streaming status and notifications
- **Security**: Enterprise-grade authentication

[Learn more about A2A](https://a2a-protocol.org/latest/)

### MCP (Model Context Protocol)

MCP provides a universal interface for connecting AI systems to external data sources:

- **Standardized Connectors**: Single protocol for multiple data sources
- **Bidirectional Communication**: Read and write operations
- **Context Preservation**: Maintain context across tool usage
- **Extensible Ecosystem**: Growing library of MCP servers

[Learn more about MCP](https://modelcontextprotocol.info/)

## 🧪 Testing

```bash
# Run tests
bun test
```

## 📖 Project Structure

```
podlet/
├── app/                    # Main application server
│   ├── src/
│   │   └── index.ts       # Elysia server entry point
│   ├── package.json
│   └── tsconfig.json
├── test-readme-agent.yaml # Example agent configuration
├── README.md
└── LICENSE
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the terms specified in the LICENSE file.

## 🔗 Links

- [A2A Protocol Specification](https://a2a-protocol.org/latest/)
- [MCP Documentation](https://modelcontextprotocol.info/)
- [Elysia Framework](https://elysiajs.com/)
- [Bun Runtime](https://bun.sh/)

## 🙏 Acknowledgments

- Built on [Google's A2A Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- Integrates [Anthropic's MCP](https://www.anthropic.com/news/model-context-protocol)
- Powered by [Elysia](https://elysiajs.com/) and [Bun](https://bun.sh/)

---

**Podlet** - The future of intelligent agent orchestration 🤖
