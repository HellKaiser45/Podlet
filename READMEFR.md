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
| `config.json` | Paramètres globaux du serveur. Voir le schéma complet ci-dessous. |
| `models.json` | Définitions des LLM incluant le fournisseur, l'ID du modèle, la référence à la clé API et la température. |
| `mcp.json` | Configuration des serveurs MCP (commandes, arguments et variables d'environnement). |
| `.env` | Variables d'environnement pour les clés API (ex: `OPENROUTER_API_KEY`). |
| `agents/*.json` | Définitions et capacités de chaque agent. |
| `prompts/*.md` | Prompts système pour les agents. |
| `skills/` | Répertoires contenant des modules de compétences (documentés dans `SKILL.md`). |

### Schéma de config.json

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

| Champ | Description |
| :--- | :--- |
| `server.port` | Port de l'API Gateway. |
| `server.host` | Adresse de liaison de la gateway. |
| `server.pythonPort` | Port du backend Python LLM interne. |
| `server.webPort` | Port du frontend web SolidJS. |
| `database.path` | Chemin de la base SQLite (relatif à `~/.podlet/`). |
| `logging.level` | Verbosité des logs (`debug`, `info`, `warn`, `error`). |
| `features.safemode` | Active l'approbation HIL pour les outils destructeurs. |
| `features.max_concurrent_agents` | Nombre maximal d'exécutions d'agents simultanées. |
| `features.cors_origin` | Origine CORS autorisée pour le frontend. |

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

Les compétences sont des modules réutilisables qui étendent les capacités d'un agent. Elles sont stockées dans le répertoire `skills/` et consistent en un dossier contenant un fichier `SKILL.md` ainsi que des scripts, références et templates optionnels.

Podlet utilise une stratégie de **révélation progressive** pour préserver l'efficacité des fenêtres de contexte :

- **Niveau 1 — Catalogue** : Au démarrage de la session, le nom, la description et la structure de répertoire de chaque compétence sont injectés dans le prompt système afin que le modèle sache ce qui est disponible.
- **Niveau 2 — SKILL.md** : Lorsqu'une compétence est pertinente pour la tâche, le modèle lit son fichier `SKILL.md` complet via l'outil `read_file`.
- **Niveau 3 — Ressources** : Les scripts, références et templates ne sont chargés que sur demande, lorsque la compétence instruit explicitement le modèle de les utiliser.

Des instructions comportementales dans le prompt système encouragent le modèle à lire proactivement les compétences lorsqu'il détecte un domaine correspondant. Chaque agent peut définir sa propre portée de compétences via le tableau `skills` dans sa définition JSON. Pour assurer la compatibilité entre clients, les configurations de compétences basculent gracieusement vers une valeur par défaut sécurisée si le YAML est mal formé.

## Intervention Humaine (Human-in-the-Loop - HIL)

Pour empêcher des actions non autorisées, Podlet inclut un **mode sécurisé (safemode)** entièrement intégré au frontend.

- Lorsque le `safemode` est activé, la boucle de l'agent est surveillée pour détecter les appels d'outils destructeurs.
- Si une approbation est requise, le flux émet un événement `CUSTOM` portant le nom `AWAITING_APPROVAL`.
- Le frontend affiche un **ApprovalPanel** présentant chaque appel d'outil en attente avec ses arguments.
- L'utilisateur peut **Approuver** ou **Rejeter** chaque appel individuellement et fournir un retour optionnel.
- Une fois toutes les décisions collectées, la boucle de l'agent reprend automatiquement.

## Limites de Tokens

Podlet met en œuvre une budgétisation des tokens côté frontend et backend pour éviter les débordements de fenêtre de contexte et les coûts API inutiles.

**Frontend**

- Avant l'envoi d'un message, l'interface estime la consommation de tokens :
  - Texte : `caractères / 4`
  - Images : `largeur * hauteur / 750`
- Si le total estimé dépasse **50 000 tokens**, le message est rejeté immédiatement avec une erreur inline.

**Backend**

- La gateway calcule le budget token complet : prompt système + compétences injectées + arborescence de fichiers + historique de conversation + message utilisateur.
- Ce total est comparé à la `context_window` du modèle définie dans `models.json` (valeur par défaut : **128 000**).
- Si le budget est dépassé, une `TokenLimitError` est levée et émise comme événement SSE `RUN_ERROR` avec le code `TOKEN_LIMIT_EXCEEDED`.

## Système de Fichiers Virtuel (VFS)

Les agents opèrent dans un bac à sable sécurisé utilisant un VFS basé sur des schémas :

- `workspace://` : Accès en lecture seule aux fichiers d'entrée.
- `artifacts://` : Accès en écriture pour les fichiers de sortie.
- `skills://` : Accès aux ressources spécifiques aux compétences (réservé aux agents possédant ladite compétence).

Les chemins réels sont mappés vers `~/.podlet/workspace/{runId}/` et `~/.podlet/artifacts/{runId}/`.

## Constructeur d'Agents (Agent Builder)

Le **Constructeur d'Agents** est la page d'accueil par défaut accessible à `/`. Il propose une disposition maître-détail pour gérer les agents sans éditer de JSON à la main.

- **Liste des Agents** (gauche) : Une liste défilante de tous les agents avec recherche inline.
- **Détail de l'Agent** (droite) : Un éditeur complet pour l'agent sélectionné.
  - Créer, modifier et supprimer des agents en ligne.
  - **Sélecteur de modèle** lié à `models.json`.
  - **Sélecteurs de tags multi-sélection** pour les Compétences, MCPs et Sous-Agents.
  - **Éditeur de prompt** pour visualiser, modifier, créer et supprimer les prompts système stockés dans `prompts/`.
- Le bouton **INITIATE** déploie l'agent sélectionné directement dans l'interface de chat.
- **Disposition responsive** : Côte-à-côte sur bureau, empilé sur mobile.

## Tiroir de Fichiers

Le Tiroir de Fichiers est accessible depuis l'interface de chat et fournit un explorateur de fichiers complet pour l'exécution en cours.

- **Arborescence hiérarchique** avec dossiers dépliables/repliables.
- **Barre de recherche/filtrage** pour localiser rapidement les fichiers.
- **Sélection au clic** avec un panneau d'aperçu à droite.
  - Coloration syntaxique pour les fichiers source.
  - Rendu Markdown.
  - Aperçu d'images.
  - Mode édition pour les fichiers texte.
- **Téléchargement** de fichiers individuels ou de dossiers entiers au format ZIP.
- **Onglets** pour basculer entre `workspace` (entrées en lecture seule) et `artifacts` (sorties de l'agent).

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

### Agents

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/agents/all` | Liste tous les agents définis. |
| `GET` | `/agents/:agentId` | Détails d'un agent spécifique. |
| `GET` | `/agents/:agentId/prompt` | Récupère le contenu du prompt de l'agent. |
| `GET` | `/agents/prompts/list` | Liste les noms de fichiers des prompts. |
| `POST` | `/agents` | Crée un agent (corps : Agent JSON). |
| `PUT` | `/agents/:agentId` | Met à jour un agent (corps : Agent JSON partiel). |
| `DELETE` | `/agents/:agentId` | Supprime un agent. |

### Modèles

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/models/all` | Liste tous les modèles LLM configurés. |
| `GET` | `/models/:name` | Récupère la configuration d'un modèle. |
| `POST` | `/models` | Crée un modèle (corps : `{ name, config }`). |
| `PUT` | `/models/:name` | Met à jour un modèle (corps : config partielle). |
| `DELETE` | `/models/:name` | Supprime un modèle. |

### MCPs

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/mcps/all` | Liste toutes les configurations MCP. |
| `GET` | `/mcps/running` | Liste les instances MCP en cours d'exécution. |
| `GET` | `/mcps/:name` | Récupère la configuration d'un MCP. |
| `POST` | `/mcps` | Crée un MCP (corps : `{ name, config }`). |
| `PUT` | `/mcps/:name` | Met à jour un MCP (corps : config partielle). |
| `DELETE` | `/mcps/:name` | Supprime un MCP (l'arrête s'il est en cours d'exécution). |
| `POST` | `/mcps/:name/start` | Démarre le serveur MCP. |
| `POST` | `/mcps/:name/stop` | Arrête le serveur MCP. |

### Prompts

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/prompts/all` | Liste les noms de fichiers des prompts. |
| `GET` | `/prompts/:name` | Récupère le contenu d'un prompt. |
| `POST` | `/prompts` | Crée un prompt (corps : `{ name, content }`). |
| `PUT` | `/prompts/:name` | Met à jour un prompt (corps : `{ content }`). |
| `DELETE` | `/prompts/:name` | Supprime un prompt. |

### Compétences

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `GET` | `/skills/all` | Liste toutes les compétences disponibles. |

### Fichiers

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `POST` | `/file/upload` | Téléverse des fichiers vers une exécution. |
| `GET` | `/file/:runid/:fileid` | Lit le contenu d'un fichier. |
| `GET` | `/file/download/:runid/:fileid` | Télécharge un fichier. |
| `GET` | `/file/download-zip/:runid/:folderid` | Télécharge un dossier au format ZIP. |
| `GET` | `/file/all/:runid` | Liste tous les fichiers d'une exécution. |

### Backend Python (Interne)

| Méthode | Chemin | Description |
| :--- | :--- | :--- |
| `POST` | `http://localhost:8000/chat/stream` | Complétions LLM en streaming. |

## Événements SSE

Le point de terminaison de chat diffuse des événements via SSE. Les clients doivent gérer les types d'événements suivants :

| Événement | Description |
| :--- | :--- |
| `RUN_STARTED` | Émis lorsqu'une exécution d'agent démarre. |
| `RUN_FINISHED` | Émis lorsqu'une exécution d'agent se termine. La charge utile inclut le `result` final avec `status`. |
| `CUSTOM` | Événements applicatifs personnalisés. Actuellement utilisé pour `AWAITING_APPROVAL` lors du HIL. |
| `RUN_ERROR` | Émis en cas d'erreur irrécupérable. La charge utile inclut `message` et `code` (ex: `TOKEN_LIMIT_EXCEEDED`). |

## Interface Frontend

L'interface web est accessible sur `http://localhost:3002` par défaut mais peut être configurée dans `~/.podlet/config.json`.

- **Gestion des Fils** : Barre latérale pour organiser les conversations.
- **UI de Streaming** : Réponses en temps réel avec indicateurs de frappe.
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

### Réalisé

- [x] **HIL Frontend** — ApprovalPanel avec approbation/rejet par outil.
- [x] **API CRUD Complète** — Agents, Modèles, MCPs, Prompts.
- [x] **Constructeur d'Agents** — Interface maître-détail à `/`.
- [x] **Arborescence de Fichiers** — Explorateur hiérarchique avec recherche et téléchargement.
- [x] **Gardiens de Tokens** — Pré-vérification frontend + contrôle backend.

### v0.2 — Prochainement

- [ ] **Outil CLI** — Alternative terminal pour un usage sans interface web.
- [ ] **Isolation des Outils** — Sandbox renforcée et limites VFS plus strictes.

### v0.3 — Planifié

- [ ] **Isolation VFS Totale** — Sandbox type chroot sans vecteur d'évasion.
- [ ] **Déploiement Docker** — `docker-compose` pour une installation en production.
- [ ] **Configuration Versionnée** — Système de migration pour les mises à jour.
- [ ] **Compaction de l'Historique** — Résumé automatique des conversations longues.

### v0.4 — Envisagé

- [ ] **Gestion de la Mémoire** — Stratégies de résumé et rappel basé sur RAG.
- [ ] **Historique Partagé** — Meilleur passage de contexte entre parents et sous-agents.

## Contribution

Les contributions sont les bienvenues ! Veuillez ouvrir un problème (issue) ou soumettre une demande de modification (pull request).

## Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.
