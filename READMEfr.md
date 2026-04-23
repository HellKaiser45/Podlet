<img src="podlet-logo.png" width="200" />

# Podlet

> Un système d'orchestration d'agents intelligents avec des flux de travail multi-agents, un sandboxing d'outils et une supervision humaine (human-in-the-loop).

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![Python](https://img.shields.io/badge/python-3.10+-blue)](https://python.org)
[![SolidJS](https://img.shields.io/badge/frontend-SolidJS-blue)](https://solidjs.com)

## Qu'est-ce que Podlet

Podlet est un opérateur d'agents IA modulaire. Les agents sont sans état (stateless) — ils sont créés et détruits à chaque exécution de conversation. Le système orchestre des flux de travail multi-agents où un agent orchestrateur principal répartit les tâches vers des sous-agents spécialisés (Codeur, Architecte Frontend, Architecte Backend, Réviseur de Code, etc.). Chaque agent possède son propre modèle LLM, son prompt système, ses outils, ses compétences (skills) et ses sous-agents. Le système supporte :
- **LLM multi-fournisseurs** via LiteLLM (OpenAI, Anthropic, OpenRouter, Gemini, Ollama, points de terminaison personnalisés)
- **MCP (Model Context Protocol)** pour l'intégration d'outils externes
- **Skills** — Modules avec frontmatter YAML injectés dans les prompts des agents
- **Human-in-the-loop** — Approbation humaine pour les appels d'outils sensibles
- **Système de fichiers virtuel (VFS)** — Opérations de fichiers isolées avec les schémas `/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db` et `/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db`
- **Streaming SSE** suivant les spécifications d'événements AG-UI

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

## Démarrage rapide

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.ps1 | iex

# Installation manuelle
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun run init     # Assistant de configuration interactif
bun run start    # Lancement de tous les services
```

## Installation manuelle

Prérequis :
- **Bun** >= 1.0 — https://bun.sh
- **Python** >= 3.10 — https://python.org
- **Git** — https://git-scm.com

Étapes :
```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun install
python3 -m venv agent_core_py/.venv
source agent_core_py/.venv/bin/activate  # Windows: agent_core_py\\.venv\\Scripts\\activate
pip install -r agent_core_py/requirements.txt
bun run init
```

Scripts disponibles :
| Commande | Description |
|---|---|
| `bun run init` | Assistant de configuration interactif (vérification des prérequis, installation des dépendances, génération de la config) |
| `bun run start` | Démarrer tous les services (gateway + python + web UI) |
| `bun run start:gateway` | Démarrer uniquement la gateway Elysia |
| `bun run start:python` | Démarrer uniquement le backend LLM Python |
| `bun run dev:gateway` | Démarrer la gateway en mode watch |
| `bun run dev:web` | Démarrer l'interface web en mode dev |

## Configuration

Toute la configuration d'exécution se trouve dans `~/.podlet/` :

```
~/.podlet/
├── config.json        # Paramètres du serveur (port, hôte, fonctionnalités)
├── models.json        # Définitions des modèles LLM
├── mcp.json           # Définitions des serveurs MCP
├── .env               # Clés API
├── agents/            # Définitions des agents (*.json)
│   ├── code_architect.json
│   ├── coder_agent.json
│   └── ...
├── prompts/           # Prompts système des agents (*.md)
│   ├── code_architect.md
│   ├── coder_agent.md
│   └── ...
└── skills/            # Modules de compétences (chacun avec SKILL.md)
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
Chaque clé est un alias de modèle utilisé dans les définitions d'agents :
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
Champs : `provider` (requis), `model` (requis), `api_key_name` (nom de la variable d'environnement pour la clé API), `temperature`, `max_tokens`, `base_url` (pour les points de terminaison personnalisés).

Fournisseurs supportés : openai, anthropic, openrouter, gemini, ollama, ou tout fournisseur compatible LiteLLM.

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

#### Schéma de définition d'un agent
```json
{
  "agentId": "unique-agent-name",
  "agentDescription": "Ce que fait cet agent",
  "model": "fast",              // Clé issue de models.json
  "system_prompt": "prompt.md", // Nom du fichier dans prompts/
  "mcps": ["context7"],         // Optionnel : IDs des serveurs MCP
  "skills": ["idea-refine"],    // Optionnel : Noms des compétences
  "subAgents": ["Coder"],       // Optionnel : Autres agentIds à utiliser comme outils
  "response_format": {}         // Optionnel : Forcer le format de sortie
}
```

#### Créer un agent

1. Créer un fichier JSON dans `~/.podlet/agents/votre-agent.json`
2. Créer un prompt markdown dans `~/.podlet/prompts/votre-prompt.md`
3. Définir `"system_prompt"` dans le JSON avec le nom du fichier de prompt
4. Si les watchers sont activés, l'agent est chargé automatiquement. Sinon, redémarrez la gateway.

Exemple — un simple réviseur de code :
```json
// ~/.podlet/agents/reviewer.json
{
  "agentId": "Reviewer",
  "agentDescription": "Révise le code pour détecter les bugs, les problèmes de sécurité et les bonnes pratiques",
  "model": "fast",
  "system_prompt": "reviewer.md",
  "mcps": ["context7"]
}
```

#### Sous-agents (Pattern A2A)

Les agents peuvent déléguer à d'autres agents via le champ `subAgents`. Les sous-agents apparaissent comme des outils nommés `agent_{agentId}`. Lorsqu'un agent parent appelle un outil de sous-agent, l'orchestrateur crée un cadre (frame) enfant, exécute la boucle du sous-agent et renvoie le résultat à l'appel d'outil du parent. Le parent est suspendu pendant que l'enfant s'exécute.

#### Agents de base (Seed Agents)

Le script d'initialisation installe ces agents par défaut :
| Agent | Modèle | Description |
|---|---|---|
| PODLET Main Orchestrator | smart | Architecte principal, planifie et délègue |
| Coder | fast | Exécute les tâches de codage |
| PODLET Frontend Architect Agent | smart | Expert en design frontend |
| PODLET Backend Architect Agent | smart | Design d'API et de services |
| PODLET Code Reviewer Agent | fast | Revue de code et qualité |
| Documentation Master Agent | fast | Création et rédaction de documents |
| PODLET Frontend Coder Agent | fast | Implémentation frontend |
| Asset Creator Agent | fast | Crée des ressources visuelles |
| Frontend Reviewer Agent | fast | Revue de code frontend |

## Système d'outils

Les agents ont accès à trois types d'outils :

**Outils de base (Core Tools)** (toujours disponibles) :
- `read_file` — Lire un ou plusieurs fichiers du VFS
- `execute_shell` — Exécuter des commandes bash dans le sandbox (timeout 30s, max 300s)

**Outils MCP** (issus des serveurs MCP configurés) :
- Les outils sont préfixés : `{mcpId}_{toolName}` (ex: `ddg-search_search`, `context7_query-docs`)
- Démarrés à la demande lorsqu'un agent les référence dans sa liste `mcps`

**Outils de sous-agents** (issus des sous-agents configurés) :
- Les outils sont préfixés : `agent_{agentId}` (ex: `agent_Coder`)
- Paramètres : `task` (requis), `previous_action_summary`, `workspace_path`, `relevant_files`

## Compétences (Skills)

Les compétences sont des modules avec frontmatter YAML stockés dans `~/.podlet/skills/`. Chaque compétence possède un fichier `SKILL.md` :

```markdown
---
name: ma-competence
description: Ce que fait cette compétence
---

Les instructions et références de la compétence vont ici.
```

Lorsqu'un agent a des compétences configurées, elles sont injectées dans le prompt système sous forme de blocs XML :
```xml
<available_skills>
<skill>
<name>ma-competence</name>
<description>...</description>
<location>/home/hellkaiser/.podlet/skillsma-competence/SKILL.md</location>
</skill>
</available_skills>
```

Les agents peuvent ensuite lire le fichier SKILL.md pour obtenir les instructions.

## Human-in-the-Loop (HIL)

Lorsque le HIL est activé (config `features.hil_enabled` ou `safemode`), le système intercepte les appels d'outils correspondant à des mots-clés d'édition (write, edit, create, delete, execute, shell, etc.) et suspend l'exécution.

**Flux :**
1. L'agent appelle un outil sensible
2. Le HIL Manager marque l'appel d'outil comme `pending`
3. Le cadre est sauvegardé dans la base de données avec `status: "suspended"`
4. L'événement SSE `AWAITING_APPROVAL` est envoyé au frontend
5. L'utilisateur envoie une décision d'approbation/rejet via `POST /api/chat` avec le champ `decision`
6. L'orchestrateur reprend la boucle de l'agent

**Format de décision :**
```json
{
  "toolCallId": {
    "approved": true,
    "feedback": "commentaire optionnel en cas de rejet"
  }
}
```

## Système de fichiers virtuel (VFS)

Les agents opèrent dans un système de fichiers virtuel sandboxé avec trois schémas :

| Schéma | But | Lecture | Écriture |
|---|---|---|---|
| `/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db` | Fichiers d'entrée utilisateur | Oui | Non (lecture seule) |
| `/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db` | Fichiers de sortie de l'agent | Oui | Oui |
| `/home/hellkaiser/.podlet/skills` | Ressources de compétences | Oui | Non |

Les chemins réels sont résolus vers `~/.podlet/workspace/{runId}/` et `~/.podlet/artifacts/{runId}/`. Le VFS bloque :
- Le parcours de dossiers (`..`)
- Les chemins absolus hors sandbox
- Les URLs
- L'accès non autorisé aux schémas

## Référence API

Toutes les routes API sont préfixées par `/api`. Documentation interactive sur `http://localhost:3000/api/openapi`.

| Méthode | Chemin | Description |
|---|---|---|
| POST | /api/chat | Démarrer/reprendre l'exécution de l'agent (flux SSE) |
| GET | /api/history/:runid | Obtenir l'historique des messages |
| GET | /api/runids | Lister tous les IDs d'exécution |
| PATCH | /api/history/label/:runid | Définir un label pour une exécution |
| DELETE | /api/chat/:runid | Supprimer l'historique et le VFS d'une exécution |
| GET | /api/agents/all | Lister tous les agents |
| GET | /api/agents/:agentId | Obtenir la définition d'un agent spécifique |
| GET | /api/models/all | Lister toutes les configurations de modèles |
| GET | /api/mcps/all | Lister toutes les configurations MCP |
| GET | /api/mcps/running | Lister les instances MCP en cours d'exécution |
| POST | /api/file/upload | Télécharger des fichiers (multipart) |
| GET | /api/file/download/:runid/:fileid | Télécharger un fichier |
| GET | /api/file/:runid/:fileid | Lire le contenu texte d'un fichier |
| GET | /api/file/all/:runid | Lister tous les fichiers d'une exécution |
| DELETE | /api/file/:runid/:fileid | Supprimer un fichier |
| PATCH | /api/file/:runid/:fileid | Mettre à jour le contenu d'un fichier |

Backend Python sur `http://localhost:8000` :
| POST | /chat/stream | Complétion LLM en streaming SSE |

## Frontend

L'interface web fonctionne sur `http://localhost:3002` et propose :
- Des conversations basées sur des fils (threads)
- Streaming SSE en temps réel avec indicateurs de saisie
- Support du téléchargement de fichiers et des pièces jointes
- Sélection d'agent
- Barre latérale d'historique des conversations
- Thème sombre (Catppuccin Mocha via DaisyUI)

## Technologies

| Composant | Technologie |
|---|---|
| Runtime Gateway | Bun |
| Framework Gateway | Elysia.js |
| Backend LLM | Python FastAPI + LiteLLM |
| Frontend | SolidJS |
| Build Frontend | Vite |
| Styling | Tailwind CSS + DaisyUI |
| Base de données | SQLite (Drizzle ORM) |
| Client API | @elysiajs/eden |
| Événements Agent | AG-UI (SSE) |
| Protocole d'outils | MCP |
| Gestionnaire de paquets | Bun (monorepo workspaces) |

## Feuille de route

### v0.2 — À venir
- [ ] **Outil CLI** — Alternative basée sur le terminal à l'interface web pour un usage sans tête/terminal
- [ ] **Refonte HIL** — Correction de l'implémentation actuelle du human-in-the-loop : suspension/reprise fiable, config d'approbation par agent/outil, améliorations de l'intégration UI
- [ ] **Isolation accrue des outils** — Sandboxing plus strict, limitation du débit et garde-fous pour l'exécution des outils

### v0.3 — Planifié
- [ ] **Isolation complète du VFS** — Système de fichiers virtuel complet sans vecteurs d'évasion, sandboxing type chroot
- [ ] **Déploiement Docker** — Installation conteneurisée avec docker-compose pour la production
- [ ] **Configuration versionnée** — Système de migration pour les fichiers de configuration entre les versions

### v0.4 — Envisagé
- [ ] **Système de gestion de la mémoire** — Gestion des longues conversations : résumé de conversation, fenêtre de contexte glissante, rappel de mémoire à long terme basé sur le RAG
- [ ] **Historique des messages des sous-agents** — Historique partagé entre agents parents et enfants pour un meilleur passage de contexte et débogage

## Contribuer
Les contributions sont les bienvenues. Forkez le dépôt, créez une branche de fonctionnalité et ouvrez une pull request.

## Licence
Ce projet est sous licence selon les termes spécifiés dans le fichier [LICENSE](LICENSE).
