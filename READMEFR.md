<img src="podlet-logo.png" width="200" />

# Podlet

**Système d'Orchestration Modulaire d'Agents IA**

[![Licence](https://img.shields.io/badge/Licence-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-black)](https://bun.sh)
[![Docker](https://img.shields.io/badge/Docker-Pr%C3%AAt-blue)](https://www.docker.com/)
[![PR Bienvenues](https://img.shields.io/badge/PRs-bienvenues-green.svg)](CONTRIBUTING.md)

## Qu'est-ce que Podlet ?

Podlet est un système d'orchestration d'agents IA : une passerelle TypeScript rapide, un backend LLM Python flexible et une interface SolidJS réactive. Les agents spécialisés collaborent, utilisent des outils externes via MCP (Model Context Protocol) et opèrent dans un système de fichiers virtuel sécurisé.

---

### Sommaire

- [Qu'est-ce que Podlet ?](#quest-ce-que-podlet)
- [Démarrage Rapide](#démarrage-rapide)
- [Configuration Docker](#configuration-docker)
- [Architecture](#architecture)
- [Configuration](#configuration) — [`config.json`](#configjson) · [`.env`](#env) · [`models.json`](#modelsjson) · [`mcp.json`](#mcpjson)
- [Agents](#agents)
- [Système d'Outils](#système-doutils)
- [Skills](#skills)
- [Human-in-the-Loop](#human-in-the-loop-hil)
- [Système de Fichiers Virtuel](#système-de-fichiers-virtuel-vfs)
- [Agent Builder](#agent-builder)
- [Tiroir de Fichiers](#tiroir-de-fichiers)
- [Référence API](#référence-api)
- [Frontend](#frontend)
- [Sécurité](#sécurité)
- [Stack Technique](#stack-technique)
- [Contribution](#contribution)
- [Licence](#licence)

---

## Démarrage Rapide

### Docker (Recommandé)

**Prérequis :** Docker et Docker Compose

```bash
curl -fsSL https://raw.githubusercontent.com/HellKaiser45/Podlet/main/install.sh | bash
# Choisissez l'option 1 (Docker)
```

Ou manuellement :

```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
docker compose run --rm gateway bun run init --docker
docker compose up -d
```

Visitez `http://localhost:3002`

> [!NOTE]
> Utilisateurs Windows : le montage de données utilise `$HOME/.podlet`, qui n'existe pas dans un shell Windows standard. Définissez la variable d'environnement `HOME` ou utilisez WSL.

### Installation Native

**Prérequis :** [Bun](https://bun.sh) 1.0+ et Python 3.12+

```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun install
cd agent_core_py && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && cd ..
bun run start
```

L'interface est disponible sur `http://localhost:3002`.

---

## Configuration Docker

Les conteneurs montent `~/.podlet` (bind mount, pas de volume nommé) — mêmes données que le mode natif.

### Modifier le port exposé

Éditez le mappage de ports dans `compose.yml` (par ex. `3002:3000` → `8080:3000`), puis :

```bash
docker compose up -d
```

### Gestion des données

```bash
# Sauvegarde
cp -r ~/.podlet ~/podlet-backup

# Réinitialisation complète
rm -rf ~/.podlet && docker compose up -d
```

> [!CAUTION]
> La réinitialisation supprime définitivement toutes vos données : agents personnalisés, historique, clés API, fichiers de travail.

---

## Architecture

Trois composants, un seul point d'entrée :

| Composant | Technologie | Rôle |
|---|---|---|
| **Gateway** | Bun + Elysia (TypeScript) | API, agents, outils, sandbox, interface web |
| **Backend LLM** | Python + FastAPI | Appels aux modèles, streaming |
| **Frontend** | SolidJS + Vite | Interface utilisateur |

Le flux d'une requête : navigateur → Gateway (port 3000) → backend Python (port 8000) → fournisseur LLM.

---

## Configuration

Toute la configuration vit dans `~/.podlet/` — code dans le dépôt, données dans votre répertoire personnel.

<details>
<summary>Exemple complet de <code>~/.podlet/config.json</code></summary>

```json
{
  "server": {
    "port": 3000,
    "host": "127.0.0.1",
    "pythonPort": 8000,
    "webPort": 3002
  },
  "database": { "path": "podlet.db" },
  "features": { "safemode": false }
}
```

</details>

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `server.port` | nombre | `3000` | Port de l'API Gateway. Natif : ajustable. Docker : conserver 3000. |
| `server.host` | chaîne | `"127.0.0.1"` | Adresse d'écoute. Docker force `0.0.0.0` — valeur ignorée en conteneur. |
| `server.pythonPort` | nombre | `8000` | Port du backend Python (natif). Docker : conserver 8000. |
| `server.webPort` | nombre | `3002` | Port de l'interface web (natif uniquement). Aucun effet en Docker — le port publié provient du mappage compose. Définit aussi l'origine CORS. |
| `database.path` | chaîne | `"podlet.db"` | Nom du fichier SQLite dans `~/.podlet`. |
| `features.safemode` | booléen | `false` | Approbation Human-in-the-Loop pour les appels d'outils destructifs. |

### Règles de ports par mode

| Champ | Natif | Docker |
|---|---|---|
| `server.port` | 🟢 Ajustable | 🔴 Conserver 3000 |
| `server.pythonPort` | 🟢 Ajustable | 🔴 Conserver 8000 |
| `server.webPort` | 🟢 Ajustable | ⚪ Aucun effet |
| `server.host` | 🔵 Spécial | 🔵 Forcé à `0.0.0.0` |

```diff
# Ports — natif : libres ; Docker : fixes
- server.port : 3000        (Docker : ne pas modifier)
- server.pythonPort : 8000  (Docker : ne pas modifier)
+ server.webPort : 3002     (natif uniquement, Vite)
+ server.host : 127.0.0.1   (Docker force 0.0.0.0)
```

> [!WARNING]
> Sous Docker, conservez `server.port` à 3000 et `server.pythonPort` à 8000 — le mappage de ports compose et l'image agent-core en dépendent. `server.webPort` n'a aucun effet en Docker.

> [!TIP]
> D'anciennes clés (`logging`, `cors_origin`, `exposedPort`, `max_concurrent_agents`, bloc `docker`) ne sont lues par aucun code. Présentes dans de vieux fichiers, elles sont sans danger et peuvent être supprimées.

> [!IMPORTANT]
> Identifiants d'agents : lettres (majuscules autorisées), chiffres, `-` et `_`, de 1 à 58 caractères. Les espaces sont invalides — ils casseraient les noms d'outils `agent_<id>`.

### `.env`

Clés API des fournisseurs (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) — lues par le backend Python à chaque appel.

### `models.json`

Définitions des modèles (`fast`, `smart`) : fournisseur, nom de modèle et `api_key_name` référençant `.env`.

### `mcp.json`

Serveurs MCP externes (recherche DuckDuckGo, Context7, …).

---

## Agents

Les agents sont définis dans `~/.podlet/agents/*.json` :

<details>
<summary>Schéma complet d'un agent</summary>

```json
{
  "agentId": "string",
  "agentDescription": "string",
  "model": "fast",
  "system_prompt": "prompt.md",
  "mcps": [],
  "skills": [],
  "subAgents": ["agentId1", "agentId2"]
}
```

</details>

Agents pré-configurés : orchestrateur principal, architectes backend/frontend, codeurs, vérificateurs, documentation, création d'assets. Chaque agent peut déléguer via `subAgents`.

---

## Système d'Outils

Trois catégories :

1. **Outils principaux** — fichiers, commandes, recherche web
2. **Outils MCP** — serveurs externes (Context7, DuckDuckGo…)
3. **Outils Sous-Agents** — autres agents appelables via le préfixe `agent_` (ex. `agent_Coder`)

---

## Skills

Les skills sont des modules d'instructions expertes dans `~/.podlet/skills/`. Chaque agent déclare les skills auxquels il a accès ; ils sont injectés dans son contexte à la demande.

---

## Human-in-the-Loop (HIL)

Avec `features.safemode: true`, chaque appel d'outil destructif (commande shell, écriture de fichier) requiert votre approbation dans l'interface avant exécution.

---

## Système de Fichiers Virtuel (VFS)

| Schéma | Accès |
|---|---|
| `workspace://` | Fichiers de travail (téléversements) |
| `artifacts://` | Sorties des agents |
| `skills://` | Modules de skills (liste d'autorisation par agent) |

---

## Agent Builder

L'interface permet de créer et modifier des agents : identifiant, description, modèle, prompt système, MCPs, skills et sous-agents. L'identifiant est modifiable directement depuis l'en-tête de l'agent.

---

## Tiroir de Fichiers

Parcours de l'arborescence des fichiers de travail et visualisation des sorties des agents, directement depuis l'interface.

---

## Référence API

API REST complète sur le port Gateway (3000) : agents, fichiers, modèles, prompts, skills, MCPs.

**`POST /chat/stream`** — diffuse une conversation d'agent. Les objets message portent `role` et `content` ; le flux émet des événements `keepalive` et `ping` pour maintenir la connexion ouverte.

<details>
<summary>Exemple de corps de requête (cliquer pour déplier)</summary>

```json
{
  "agentId": "main-orchestrator",
  "messages": [
    { "role": "user", "content": "Bonjour" }
  ]
}
```

</details>

---

## Frontend

SolidJS + Vite. En natif : serveur de développement Vite sur `server.webPort`. En Docker : bundle statique intégré à l'image, servi par la Gateway sur le port publié.

---

## Sécurité

- **CORS** : l'origine autorisée est dérivée de `server.webPort` (`http://localhost:<webPort>`) — non configurable séparément.
- **Sandbox** : exécution des commandes dans un environnement restreint.
- **HIL** : approbation des actions destructives (voir ci-dessus).

---

## Stack Technique

| Couche | Technologie |
|---|---|
| Runtime | Bun |
| API | Elysia |
| Base de données | SQLite + Drizzle |
| Backend LLM | FastAPI + LiteLLM |
| Frontend | SolidJS + Vite |
| Conteneurs | Docker Compose |

---

## Contribution

Les contributions sont bienvenues — ouvrez une issue ou une pull request.

---

## Licence

[MIT](LICENSE)
