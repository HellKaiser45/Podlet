# Podlet

> An intelligent agent creator system based on state-of-the-art AI protocols including A2A (Agent-to-Agent) and MCP (Model Context Protocol).

## 🚀 Overview

**Podlet** will be a modular agents operator. It is called podlet because initially it was supposed to use containers (pods)
to run agents which is still possible but not the main focus anymore.
Since there is no "Agent running". Agents are here just live and die and are completely stateless.

## Project Objectives

- Modular agent system
- Add/Remove/Edit agents and agents components using either json files or the provided API
- Support skills, mcps, sub agents
- Stream events kinda following AGUI specifications for easier front end integration.
- Remember past interactions with the user through 2 combined ways: chat history of the run (basically per agent history)
And Global user history injection. Basically a RAG through a second memory and injecting the rag results as context with the user request to the chat model.
- Context injection just like skills and everything else with specific files in a specific folder.
- Support a solid user in the loop system and other safety measures (containers, automatic approval request identifier, ... )
- Simple one liner installer (good and solid install script)

## Planned Steps

1. Good chat executor engine -> DONE Python fastapi + litellm sdk
2. Reference agents definitions and the modular file system -> Partially DONE (missing context, memories, skills)
3. Strong/Robust Agent loop (it is crazy how human in the loop and subagents skyrocket the difficulty though) -> Ongoing
4. Add skills support
5. Add context support
6. Add memories system
7. Clean gateway code (api routes and stream route of the main loop)

## TODO (from 24/02/2026)

- [ ] Refactor the gateway to wrap the loop in a whole orchestrator
- [ ] Tool executor method to finish
- [ ] Complete the loop logic with like only 3 events: Hil approval, complete, error
- [ ] Test the full loop with at least 3 tools (native shell tool, mcp , and sub-agent)
- [ ] Add events emitter based on AGUI
- [ ] Add all the crud api routes based on the file system (agens, mcps, ... )

## 📄 License

This project is licensed under the terms specified in the LICENSE file.

## 🔗 Links

- [MCP Documentation](https://modelcontextprotocol.info/)
- [Elysia Framework](https://elysiajs.com/)
- [Bun Runtime](https://bun.sh/)

---

**Podlet** - The future of intelligent agent orchestration 🤖
