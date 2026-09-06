<p align="center">
  <img src="podlet-logo.png" width="180" alt="Podlet logo" />
</p>

# Podlet

*Système modulaire d'orchestration d'agents IA — une application auto-hébergée pour orchestrer des agents spécialisés.*

![License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Démarrage rapide

*Deux façons de lancer Podlet — choisissez-en une.*

### Docker (recommandé)

**Prérequis :** Docker et Docker Compose.

```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
docker compose up -d
```

Ajoutez au moins une clé de fournisseur dans `~/.podlet/.env` (créé au premier lancement — voir [Configuration](#configuration)) :

```
ANTHROPIC_API_KEY=sk-ant-...
```

Ouvrez **<http://localhost:3000>**. *(Docker sert le frontend précompilé via le serveur gateway/Elysia — un seul processus, un seul port.)*

### ⚡ Depuis les sources

**Prérequis :** [Bun](https://bun.sh) et Python 3.12.

```bash
git clone https://github.com/HellKaiser45/Podlet.git
cd Podlet
bun install
bun run init      # installation initiale (une seule fois, initialise ~/.podlet)
bun run start     # démarre les trois services
```

Ajoutez au moins une clé de fournisseur dans `~/.podlet/.env` (voir [Configuration](#configuration)) :

```
ANTHROPIC_API_KEY=sk-ant-...
```

Ouvrez **<http://localhost:3002>**. *(Le mode source exécute un serveur de développement Vite séparé pour le frontend, d'où le port différent du 3000 de la gateway.)*

---

## Configuration

**Comment la configuration arrive là :** le dépôt fournit un dossier `.podlet/` germe (« seed ») — `config.json`, `models.json`, `mcp.json`, les agents, les skills, et un modèle `.env` vide par défaut. Au premier `bun run init` (source) ou au premier `docker compose up -d` (Docker), ce dossier germe est copié vers `~/.podlet/`, qui devient le dossier de configuration actif que l'application lit ensuite.

Vous pouvez le personnaliser avant ou après cette première copie :

- **Avant :** modifiez le dossier germe `.podlet/` du dépôt avant votre premier init/build — vos modifications seront reprises dans la copie.
- **Après :** modifiez directement `~/.podlet/` à tout moment — c'est ce que l'application en cours d'exécution lit.

**Où sont mes données ?** Les données de Podlet se trouvent dans `~/.podlet` sur la machine hôte, montées (bind mount) dans le conteneur à `/root/.podlet`. Rien n'est stocké à l'intérieur des conteneurs — la configuration, les agents, l'historique des conversations et les fichiers générés survivent tous aux reconstructions et réinitialisations.

> [!NOTE]
> **Utilisateurs Windows :** le montage utilise `$HOME/.podlet`. Dans un shell `cmd` Windows classique, `HOME` n'est souvent pas définie — définissez-la (`set HOME=%USERPROFILE%`) avant d'exécuter `docker compose up`. Dans PowerShell, utilisez plutôt `$env:HOME = $env:USERPROFILE`.

> [!CAUTION]
> L'emplacement du dossier `.podlet` dépend de votre système d'exploitation. Linux : `/home/<user>/.podlet`. macOS : `/Users/<user>/.podlet`. Windows : `C:\Users\<user>\.podlet`.
> Le dossier est caché et doit être affiché dans votre explorateur de fichiers.
> Pour le port Docker, ne changez pas les ports dans `config.json` — changez plutôt le port exposé directement dans `compose.yml`.

### `config.json`

<details>
<summary>Configuration par défaut complète (cliquer pour développer)</summary>

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

| Champ | Type | Valeur par défaut | Effet |
|---|---|---|---|
| `server.port` | nombre | `3000` | Port de l'API de la gateway. |
| `server.host` | chaîne | `"127.0.0.1"` | Adresse d'écoute. Docker force `0.0.0.0`. |
| `server.pythonPort` | nombre | `8000` | Port du backend Python (mode natif). |
| `server.webPort` | nombre | `3002` | Port de l'interface web (natif uniquement). Détermine aussi l'origine CORS. |
| `database.path` | chaîne | `"podlet.db"` | Nom du fichier SQLite dans `~/.podlet`. |
| `features.safemode` | booléen | `false` | Validation humaine (Human-in-the-Loop) pour les appels d'outils destructeurs. |

**Règles de port selon le mode :**

| Paramètre | Natif | Docker |
|---|---|---|
| `server.port` | 🟢 modifiable | 🔴 laisser à `3000` — le mapping du compose cible cette valeur |
| `server.pythonPort` | 🟢 modifiable | 🔴 laisser à `8000` — agent-core écoute sur ce port |
| `server.webPort` | 🟢 modifiable | ⚪ sans effet — la gateway sert le bundle précompilé |
| `server.host` | 🟢 modifiable | 🔵 forcé à `0.0.0.0` (géré automatiquement, non configurable par l'utilisateur) |

### Changer le port exposé

Le fichier compose mappe la gateway en `3000:3000`. Pour exposer Podlet sur un autre port de la machine hôte, modifiez cette ligne dans `compose.yml` (par exemple `8080:3000`) puis relancez `docker compose up -d`.

> [!WARNING]
> Sous Docker, modifier `server.port` ou `server.pythonPort` dans `config.json` casse l'application silencieusement — le mapping du compose et l'image agent-core dépendent de ces valeurs fixes. Utilisez plutôt la ligne de port du compose pour changer le port exposé.

---

### `.env`

Les clés d'API se trouvent dans `~/.podlet/.env`, une par fournisseur (`OPENAI_API_KEY=...`, `ANTHROPIC_API_KEY=...`, ...). Le core Python lit ce fichier à chaque requête — les modifications s'appliquent sans redémarrage.

### `models.json`

Fait correspondre les identifiants de modèles utilisés par les agents aux modèles réels des fournisseurs :

```json
{
  "fast": { "provider": "openrouter", "model": "zai/glm-4.6", "api_key_name": "OPENROUTER_API_KEY" },
  "smart": { "provider": "anthropic", "model": "claude-sonnet-4-20250514", "api_key_name": "ANTHROPIC_API_KEY" }
}
```

Le champ `api_key_name` n'est nécessaire que si le fournisseur est « petit, récent ou de niche » et n'est pas officiellement pris en charge par [litellm](https://docs.litellm.ai/docs/providers), ou si vous souhaitez un `api_key_name` personnalisé.

Les fichiers d'agents référencent ces entrées par leur clé (`"model": "smart"`) — voir [Configuration des agents](#configuration-des-agents) ci-dessous.

### `mcp.json`

Déclare les serveurs MCP ; l'ensemble par défaut inclut `context7` (recherche documentaire) et `ddg-search` (recherche web).

---

## Configuration des agents

Les agents sont des fichiers JSON dans `~/.podlet/agents/`, chargés au démarrage de la gateway.

<details>
<summary>Exemple de fichier d'agent (cliquer pour développer)</summary>

```json
{
  "agentId": "backend-architect",
  "agentDescription": "Conçoit les contrats d'API, les modèles de données et les limites des services.",
  "model": "smart",
  "system_prompt": "backend_architect.md",
  "mcps": ["context7"],
  "skills": ["api-and-interface-design"],
  "subAgents": ["frontend-architect", "database-designer"]
}
```

</details>

> [!IMPORTANT]
> **Les identifiants d'agent sont des identifiants, pas des libellés.** Autorisés : lettres (majuscules ou minuscules), chiffres, `-` et `_`, de 1 à 58 caractères. L'identifiant devient le nom de l'outil de délégation (`agent_<id>`), donc les espaces cassent les appels d'outils — et les identifiants invalides sont rejetés au chargement, avec un avertissement dans les logs de la gateway.

- **`model`** — une clé de `models.json` (par ex. `"smart"`, `"fast"`), pas un identifiant brut de modèle fournisseur.
- **`system_prompt`** — le nom de fichier d'un fichier Markdown (un prompt par fichier) dans `~/.podlet/prompts/`. `"backend_architect.md"` correspond à `~/.podlet/prompts/backend_architect.md`.
- **`mcps`** — suit la même convention que Claude Code : une liste de noms de serveurs déclarés dans `mcp.json` auxquels cet agent doit avoir accès. Laisser vide pour aucun accès MCP.
- **`subAgents`** — une liste d'`agentId` auxquels cet agent peut déléguer. Chaque identifiant devient un outil `agent_<id>` appelable depuis le contexte de cet agent, selon la même règle de nommage que les agents de premier niveau.

---

## Skills

Les skills sont des ensembles d'instructions situés dans `~/.podlet/skills/`, initialisés au premier lancement à partir de l'ensemble fourni dans `.podlet/skills/`. Un observateur de fichiers (file watcher) les recharge automatiquement — aucun redémarrage nécessaire.

Pour plus d'informations sur les skills, consultez [la documentation Claude](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

---

## Supervision humaine (Human-in-the-Loop)

Avec `features.safemode: true`, les appels d'outils destructeurs (suppression de fichiers, commandes shell) sont mis en pause et demandent une approbation dans l'interface avant leur exécution. Approuvez ou rejetez chaque demande ; rien ne s'exécute sans votre accord.

---

## Système de fichiers virtuel

Chaque exécution de conversation dispose de deux dossiers isolés (sandboxés) sous `~/.podlet/` :

| Dossier | Objectif | Accès |
|---|---|---|
| `workspace/<runId>/` | Vos fichiers importés | Lecture seule pour les agents |
| `artifacts/<runId>/` | Fichiers générés par les agents | Accessible en écriture, sous-dossiers par agent |

Les agents ne peuvent rien modifier en dehors de ces racines ou du dossier des skills.

---

## Pile technique

| Couche | Technologies |
|---|---|
| Gateway | Bun, Elysia, Drizzle ORM + SQLite, MCP TypeScript SDK, Zod |
| Agent Core | Python 3.12, FastAPI, litellm, uvicorn, python-dotenv |
| Frontend | SolidJS, Vite |

---

## Contribuer

Respectez le style de commit : `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Consultez [AGENTS.md](AGENTS.md) pour les notes d'architecture.

---

## Licence

MIT — voir [LICENSE](LICENSE).
