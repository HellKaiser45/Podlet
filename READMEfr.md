<img src="podlet-logo.png" width="200" />

# Podlet
**Système d'Orchestration Modulaire d'Agents IA**

[![Licence](https://img.shields.io/badge/Licence-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black)](https://bun.sh)
[![Python](https://img.shields.io/badge/Backend-Python%203.10+-blue)](https://www.python.org)

## Qu'est-ce que Podlet ?
Podlet est un système d'orchestration haute performance conçu pour gérer des flux de travail d'agents IA complexes. En combinant une passerelle (Gateway) TypeScript rapide, un backend LLM Python flexible et une interface frontend SolidJS réactive, Podlet permet la création d'agents spécialisés capables de collaborer, d'utiliser des outils externes via MCP (Model Context Protocol) et d'opérer dans un système de fichiers virtuel sécurisé.

## Architecture
```text
       [ Interface Utilisateur ] <------> [ Gateway (Elysia/Bun) ] <------> [ Backend Python (FastAPI) ]
       (SolidJS / Web)                     (Orchestrateur & API)               (LiteLLM / Streaming)
                                                   |                                    |
                                                   v                                    v
                                           [ Système de Fichiers ]                 [ Fournisseurs LLM ]
                                           (Workspace/Artifacts)                    (OpenRouter, OpenAI, 
                                                                                      Ollama, Gemini, etc.)
                                                   |
                                                   +------> [ Serveurs MCP ]
                                                            (Recherche, Contexte, etc.)
```

## Démarrage Rapide

### Linux / macOS
```bash
curl -fsSL https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.sh | bash
```

### Windows PowerShell
```powershell
irm https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.ps1 | iex
```

## Installation Manuelle

### Prérequis
- **Bun runtime** (dernière version)
- **Python 3.10+**
- **Git**

### Installation
1. **Cloner le dépôt**
   ```bash
   git clone https://github.com/HellKaiser45/Podlet.git
   cd Podlet
   ```
2. **Initialiser le système**
   ```bash
   bun run init
   ```
   *Cet assistant interactif vérifie les prérequis, installe les dépendances et vous aide à configurer votre environnement.*
3. **Lancer tous les services**
   ```bash
   bun run start
   ```

**Autres scripts disponibles :**
- `bun run start:gateway` — Lance uniquement la Gateway.
- `bun run start:python` — Lance uniquement le backend Python.

## Configuration
Podlet utilise un répertoire de configuration dédié situé dans `~/.podlet/` (référencé comme `podeletDir` dans le code).

| Fichier | Description |
| :--- | :--- |
| `config.json` | Paramètres globaux du serveur : port, chemins de base de données, logs et flags de fonctionnalités. |
| `models.json` | Définitions des LLM incluant le fournisseur, l'ID du modèle, la référence à la clé API et la température. |
| `mcp.json` | Configuration des serveurs MCP (commandes, arguments et variables d'environnement). |
| `.env` | Variables d'environnement pour les clés API (ex: `OPENROUTER_API_KEY`). |
| `agents/*.json` | Définitions et capacités de chaque agent. |
| `prompts/*.md` | Prompts système pour les agents. |
| `skills/` | Répertoires contenant des modules de compétences (documentés dans `SKILL.md`). |

## Agents
Les agents sont les unités centrales de Podlet. Ils sont définis dans `~/.podlet/agents/*.json`.

### Schéma de l'Agent
```json
{
  "agentId": "string",
  "agentDescription": "string",
  "model": "string (clé issue de models.json)",
  "system_prompt": "string (nom du fichier dans prompts/)",
  "mcps": ["mcpId1", "mcpId2"],
  "skills": ["skill-name1", "skill-name2"],
  "subAgents": ["agentId1", "agentId2"]
}
```

### Agents Prédéfinis (Seed Agents)
Podlet est fourni avec un ensemble d'agents pré-configurés :
- **PODLET Main Orchestrator** : Point d'entrée principal pour les tâches complexes.
- **Coder** : Spécialisé dans l'écriture et le raffinage de code.
- **Frontend Architect / Coder** : Gère la conception et l'implémentation de l'UI.
- **Backend Architect** : Conçoit les structures API et base de données.
- **Code Reviewer** : Analyse la qualité du code et détecte les bugs.
- **Documentation Master** : Crée des documents techniques professionnels.
- **Asset Creator** : Gère les ressources visuelles et multimédias.
- **Frontend Reviewer** : Audite l'implémentation UI/UX.

## Système d'Outils
Les agents ont accès à trois catégories d'outils :
1. **Outils Core** : Capacités intégrées comme `read_file` et `execute_shell` (sandbox).
2. **Outils MCP** : Outils fournis par des serveurs MCP définis dans `mcp.json` (ex: `ddg-search_search`).
3. **Outils Sous-Agents** : D'autres agents peuvent être appelés comme des outils via le préfixe `agent_` (ex: `agent_Coder`).

## Compétences (Skills)
Les compétences sont des modules réutilisables qui étendent les capacités d'un agent. Elles sont stockées dans le répertoire `skills/` et consistent en un dossier contenant un fichier `SKILL.md`. Le contenu de la compétence est injecté dans le prompt système de l'agent au moment de l'exécution.

## Intervention Humaine (Human-in-the-Loop - HIL)
Pour empêcher des actions non autorisées, Podlet inclut un **mode sécurisé (safemode)**.
- Le `HilManager` surveille les appels d'outils pour des "mots-clés d'édition" (ex: `write`, `edit`, `delete`, `execute`).
- Si une correspondance est trouvée, la boucle de l'agent est **suspendue** (`status: "suspended"`).
- L'utilisateur est invité à **Approuver** ou **Rejeter** l'action (avec un retour optionnel) via l'interface avant que l'agent puisse continuer.

## Système de Fichiers Virtuel (VFS)
Les agents opèrent dans un bac à sable sécurisé utilisant un VFS basé sur des schémas :
- `/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db` : Accès en lecture seule aux fichiers d'entrée.
- `/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db` : Accès en écriture pour les fichiers de sortie.
- `/home/hellkaiser/.podlet/skills` : Accès aux ressources spécifiques aux compétences (réservé aux agents possédant ladite compétence).

Les chemins réels sont mappés vers `~/.podlet/workspace/{runId}/` et `~/.podlet/artifacts/{runId}/`.

## Référence API
URL de base : `http://localhost:3000/api` | Documentation Interactive : `/api/openapi`

### Chat
| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `POST` | `/chat` | Flux SSE pour l'interaction avec les agents. |
| `GET` | `/history/:runid` | Récupère l'historique d'une exécution spécifique. |
| `GET` | `/runids` | Liste tous les IDs d'exécution de session. |
| `PATCH` | `/history/label/:runid` | Ajoute un label à une exécution. |
| `DELETE` | `/chat/:runid` | Supprime l'historique et le VFS d'une exécution. |

### Agents & Modèles
| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/agents/all` | Liste tous les agents définis. |
| `GET` | `/agents/:agentId` | Détails d'un agent spécifique. |
| `GET` | `/models/all` | Liste tous les modèles LLM configurés. |

### MCP & Fichiers
| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/mcps/all` | Liste les configurations MCP. |
| `GET` | `/mcps/running` | Liste les instances MCP actives. |
| `POST` | `/file/upload` | Télécharge des fichiers vers une exécution. |
| `GET` | `/file/:runid/:fileid` | Lit le contenu d'un fichier. |
| `GET` | `/file/all/:runid` | Liste tous les fichiers d'une exécution. |

### Backend Python (Interne)
`POST http://localhost:8000/chat/stream` — Gère les complétions LLM en streaming.

## Interface Frontend
L'interface web est accessible sur `http://localhost:3002`.
- **Gestion des Fils** : Barre latérale pour organiser les conversations.
- **UI de Streaming** : Réponses en temps réel avec indicateurs de frappe.
- **Tiroir de Fichiers** : Accès rapide aux pièces jointes du VFS.
- **Agent HUD** : Vue d'ensemble des statuts et configurations des agents.
- **Style** : Thème DaisyUI Catppuccin Mocha.

## Pile Technique
| Composant | Technologie |
| :--- | :--- |
| **Runtime** | Bun (TypeScript) |
| **Passerelle** | Elysia.js |
| **Backend LLM** | Python FastAPI + LiteLLM |
| **Frontend** | SolidJS + Vite + Tailwind CSS + DaisyUI |
| **Base de Données** | SQLite (Drizzle ORM) |
| **Protocoles** | MCP, AG-UI, SSE |

## Feuille de Route (Roadmap)
### v0.2 — Prochainement
- [ ] **Outil CLI** — Alternative terminal pour un usage sans interface web.
- [ ] **Refonte HIL** — Suspension/reprise plus fiable et configuration par outil.
- [ ] **Isolation des Outils** — Sandbox renforcée et limites VFS plus strictes.

### v0.3 — Planifié
- [ ] **Isolation VFS Totale** — Sandbox type chroot sans vecteur d'évasion.
- [ ] **Déploiement Docker** — `docker-compose` pour une installation en production.
- [ ] **Configuration Versionnée** — Système de migration pour les mises à jour.

### v0.4 — Envisagé
- [ ] **Gestion de la Mémoire** — Stratégies de résumé et rappel basé sur RAG.
- [ ] **Historique Partagé** — Meilleur passage de contexte entre parents et sous-agents.

## Contribution
Les contributions sont les bienvenues ! Veuillez ouvrir un problème (issue) ou soumettre une demande de modification (pull request).

## Licence
Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.
