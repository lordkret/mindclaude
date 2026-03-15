# MindClaude

MCP server + web UI for mindmap-based structured thinking in Claude Code. Maps are stored as standard `.xmind` files.

## What it does

- **MCP Server** (stdio) — 30 tools for creating, editing, navigating, and searching mindmaps directly from Claude Code
- **Web UI** — browser-based mindmap editor with jsMind, keyboard shortcuts, version history, find, themes
- **Session tracking** — `start_session` / `end_session` tools that track what changed between Claude Code conversations
- **Git-backed** — every save creates a git commit; optional push to a remote

## Quick start

```bash
git clone https://github.com/lordkret/mindclaude.git
cd mindclaude
npm install
npm run build
```

## Setup

### 1. MCP server (Claude Code)

Add to your Claude Code MCP config (`~/.claude/claude_code_config.json` or project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "mindclaude": {
      "command": "node",
      "args": ["/absolute/path/to/mindclaude/build/index.js"]
    }
  }
}
```

Restart Claude Code. You should see mindclaude tools available (e.g. `create_map`, `add_node`, `start_session`).

### 2. Web server (optional)

The web UI lets you visually browse and edit maps in a browser.

```bash
# Basic (no auth)
npm run start:web

# With HTTP Basic Auth (recommended for remote access)
MINDCLAUDE_USER=myuser MINDCLAUDE_PASS=mypass npm run start:web
```

The server starts on port 3917. For remote access, put it behind a reverse proxy (Caddy, nginx) with TLS.

**Example Caddy config:**
```
mind.example.com {
    reverse_proxy localhost:3917
}
```

**Example systemd service:**
```ini
[Unit]
Description=MindClaude Web Server
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/mindclaude
ExecStart=/usr/bin/node build/web/index.js
Environment=MINDCLAUDE_USER=myuser
Environment=MINDCLAUDE_PASS=mypass
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### 3. Git remote (optional)

Maps are stored in `~/.mindclaude/maps/`. To sync across machines:

```bash
cd ~/.mindclaude/maps
git init
git remote add origin git@github.com:you/your-maps-repo.git
```

The web server auto-commits and pushes on every save. Push failures are non-fatal.

### 4. Storage directory

By default maps live in `~/.mindclaude/maps/`. Override with:

```bash
export MINDCLAUDE_DIR=/path/to/your/maps
```

## Session tracking

MindClaude can track sessions across Claude Code conversations. Add a `CLAUDE.md` to your project:

```markdown
# Project: my-project

This project uses MindClaude for memory. At conversation start:

1. `start_session` with project="my-project" project_path="/path/to/project"
2. Review reported changes — ask user if any need action
3. Consult Context branch for architecture, Memory for conventions
4. When done: `end_session` with summary of what was done
```

### What `start_session` does
- Creates a project map (if it doesn't exist) with Context, Memory, Sessions branches
- Creates a timestamped session node under Sessions
- Detects git changes (dirty files, new commits) since the last session
- Renders the Context branch for quick orientation

### What `end_session` does
- Saves a structured summary (what was done, decisions, files changed) to the session node
- Records the git HEAD and timestamp for next-session change detection
- Auto-saves the map and commits

### Migrating existing knowledge

Use `migrate_memory` to import markdown into a project map:

```
migrate_memory project="my-project" markdown_content="## Architecture\n- Component A does X\n..."
```

Sections (`## `) are categorized into Context (architecture, deployment, API, files) or Memory (conventions, patterns, issues) branches.

### Mindmap conventions

When working with mindmaps, follow these conventions so maps stay consistent and easy to read:

**Structure**
- Every project map has three top-level branches: `Context`, `Memory`, `Sessions`
- `Context` must always have a **"Project Purpose"** node as its first child — keep it updated with what the project does
- `Context` = stable facts (architecture, files, deployment, API)
- `Memory` = conventions, patterns, known bugs, insights

**Node content rule**
- **Multiple points → subnodes.** If content has two or more distinct items, create a child node for each rather than stuffing them into description/notes
- **Single prose → description (notes).** A single sentence or short phrase that clarifies the node title goes in the description field

**When to use description vs subnodes**

| Content | Use |
|---------|-----|
| "Handles user auth via JWT" | Description (notes) |
| Three bullet points | Subnodes |
| A list of files | Subnodes |
| One-line annotation | Description (notes) |

### Slash commands

MindClaude ships with Claude Code slash commands in `.claude/commands/`. To use them in your own project, copy them into your project's `.claude/commands/` directory:

```bash
# From your project root
mkdir -p .claude/commands
cp /path/to/mindclaude/.claude/commands/session_end.md .claude/commands/
cp /path/to/mindclaude/.claude/commands/session_reload.md .claude/commands/
```

Available commands:

| Command | Description |
|---------|-------------|
| `/session_end` | End the current session — reviews changes, calls `end_session` with summary, decisions, and files changed. Accepts optional arguments as the summary. |
| `/session_reload` | Reload the mindmap from disk/repo, check for git changes, uncommitted files, and unpushed commits. |

## Spec-kit integration

MindClaude includes [spec-kit](https://github.com/speckit) slash commands for spec-driven development. The mindmap becomes the master dashboard for feature tracking — spec-kit generates markdown files on disk, and the mindmap shows visual status.

### Installing spec-kit commands

From your project root:

```bash
# Copy the spec-kit plugin (templates, scripts, constitution)
cp -r /path/to/mindclaude/.specify .

# Copy the slash commands
mkdir -p .claude/commands
cp /path/to/mindclaude/.claude/commands/speckit.*.md .claude/commands/
```

### Available spec-kit commands

| Command | Description |
|---------|-------------|
| `/speckit.specify` | Create a feature specification from a natural language description |
| `/speckit.clarify` | Ask targeted clarification questions about an existing spec |
| `/speckit.plan` | Generate a technical implementation plan from a spec |
| `/speckit.tasks` | Break a plan into dependency-ordered, executable tasks |
| `/speckit.implement` | Execute tasks with automatic mindmap progress tracking |
| `/speckit.checklist` | Generate a custom validation checklist for a feature |
| `/speckit.analyze` | Cross-artifact consistency check across spec, plan, and tasks |
| `/speckit.constitution` | Create or update project principles that guide all specs |
| `/speckit.taskstoissues` | Convert tasks into GitHub issues |

### Mindmap integration

The `sync_speckit` and `update_speckit_task` MCP tools connect spec-kit to the mindmap:

- **`sync_speckit`** — reads `specs/` directory, creates feature nodes (gold border) with task children (light blue border), sets phase labels
- **`update_speckit_task`** — updates task status (`in-progress` → orange glow, `done` → strikethrough), auto-completes features when all tasks finish

The slash commands call these tools automatically. Features progress through phases: specify → plan → tasks → implement → done, each with a distinct left-border color in the web UI.

## Vault integration (Obsidian-compatible notes)

MindClaude can sync mindmap nodes to markdown files in an Obsidian-compatible vault. Nodes marked with `vault:true` get a corresponding `.md` file with YAML frontmatter + markdown body.

### How it works

- **Map → Vault**: nodes with `vault:true` marker are written as `slug--nodeId.md` files
- **Vault → Map**: edited `.md` files update the corresponding node (vault wins on body, map wins on structure)
- **Bidirectional sync** via the `vault_sync` MCP tool or the Sync button in the web UI

### Enabling vault on a node

In the web UI, select a node and check the "Vault" checkbox. Or via MCP:

```
edit_node node_id="abc12345" markers=["vault:true"]
```

Then trigger a sync to write the file:

```
vault_sync project="my-project"
```

### Vault storage

Files are stored in `~/.mindclaude/vault/projects/{project}/`. Override with:

```bash
export MINDCLAUDE_VAULT_DIR=/path/to/your/vault
```

The vault directory is a separate git repo. Initialize it for remote sync:

```bash
cd ~/.mindclaude/vault
git init
git remote add origin git@github.com:you/your-vault-repo.git
```

### Browsing vault notes

Three options, from lightest to heaviest:

**1. Built-in web UI** — `/vault.html` on the web server. Mobile-friendly, no extra setup. Browse, search, edit, and save notes directly in the browser.

**2. Obsidian (Docker)** — full Obsidian editor in the browser via VNC. Best for desktop use. See [Obsidian setup](#obsidian-setup-optional) below.

**3. Obsidian (native)** — open `~/.mindclaude/vault` as an Obsidian vault on your local machine. Best if you already use Obsidian.

### Obsidian setup (optional)

Run Obsidian in Docker using the included compose file:

```bash
docker compose -f docker-compose.obsidian.yml up -d
```

This starts [obsidian-remote](https://github.com/sytone/obsidian-remote) on port 3918, mounting the vault directory. Access it at `http://localhost:3918`.

To make the Vault button in the web UI open Obsidian instead of the built-in vault browser:

```bash
export MINDCLAUDE_OBSIDIAN_URL=http://localhost:3918
# or for remote access behind a reverse proxy:
export MINDCLAUDE_OBSIDIAN_URL=https://obsidian.example.com
```

**Caddy reverse proxy for Obsidian:**
```
obsidian.example.com {
    reverse_proxy localhost:3918
}
```

### Vault MCP tools

| Tool | Description |
|------|-------------|
| `vault_sync` | Bidirectional sync between map and vault |
| `vault_write` | Write a specific node to vault |
| `vault_read` | Read a vault note |
| `vault_status` | List vault-enabled nodes and sync status |

### Vault REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/vault/` | List projects with vault directories |
| GET | `/api/vault/:project` | List all notes in a project |
| GET | `/api/vault/:project/:id` | Read a note by node ID |
| PUT | `/api/vault/:project/:id` | Update a note |
| POST | `/api/vault/:project/sync` | Trigger full bidirectional sync |

## Setting up MindClaude on a new machine

Quick checklist for getting MindClaude running on a work project:

```bash
# 1. Clone and build
git clone https://github.com/lordkret/mindclaude.git
cd mindclaude
npm install && npm run build

# 2. Register MCP server with Claude Code
# Add to ~/.claude/claude_code_config.json (global) or .mcp.json (per-project):
cat <<'EOF'
{
  "mcpServers": {
    "mindclaude": {
      "command": "node",
      "args": ["/absolute/path/to/mindclaude/build/index.js"]
    }
  }
}
EOF

# 3. (Optional) Start the web UI
npm run start:web
# Or with auth: MINDCLAUDE_USER=me MINDCLAUDE_PASS=secret npm run start:web

# 4. (Optional) Sync maps/vault from a remote repo
cd ~/.mindclaude/maps && git init && git remote add origin <your-maps-repo>
cd ~/.mindclaude/vault && git init && git remote add origin <your-vault-repo>

# 5. (Optional) Run Obsidian in Docker
docker compose -f docker-compose.obsidian.yml up -d

# 6. Add CLAUDE.md to your work project
cat <<'CLEOF' > CLAUDE.md
# Project: my-project

This project uses MindClaude for memory. At conversation start:

1. `start_session` with project="my-project" project_path="/path/to/project"
2. Review reported changes — ask user if any need action
3. Consult Context branch for architecture, Memory for conventions
4. When done: `end_session` with summary of what was done
CLEOF

# 7. (Optional) Copy slash commands to your project
mkdir -p .claude/commands
cp /path/to/mindclaude/.claude/commands/session_end.md .claude/commands/
cp /path/to/mindclaude/.claude/commands/session_reload.md .claude/commands/
```

### Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MINDCLAUDE_DIR` | `~/.mindclaude/maps` | Maps storage directory |
| `MINDCLAUDE_VAULT_DIR` | `~/.mindclaude/vault` | Vault storage directory |
| `MINDCLAUDE_PORT` | `3917` | Web server port |
| `MINDCLAUDE_USER` | *(empty — no auth)* | HTTP Basic Auth username |
| `MINDCLAUDE_PASS` | *(empty — no auth)* | HTTP Basic Auth password |
| `MINDCLAUDE_OBSIDIAN_URL` | *(empty)* | URL for Obsidian remote; vault button opens built-in UI if unset |

## MCP tools reference

### Map lifecycle
| Tool | Description |
|------|-------------|
| `list_maps` | List all maps in storage |
| `create_map` | Create a new empty map |
| `open_map` | Open an existing map from disk |
| `save_map` | Save a map to disk |
| `close_map` | Close an open map |
| `sync_maps` | Git pull and reload open maps |

### Node operations
| Tool | Description |
|------|-------------|
| `add_node` | Add a child node |
| `remove_node` | Remove a node and descendants |
| `move_node` | Move a node to a new parent |
| `edit_node` | Edit title, notes, labels, markers |
| `bulk_add_nodes` | Add multiple nodes at once |

### Navigation
| Tool | Description |
|------|-------------|
| `render_map` | Render map as ASCII tree |
| `focus_node` | Show only a subtree |
| `unfocus` | Show full map |
| `fold_node` | Collapse children |
| `unfold_node` | Expand children |
| `switch_sheet` | Switch to a different sheet |
| `search_nodes` | Search by title, notes, or labels |

### Cross-links
| Tool | Description |
|------|-------------|
| `add_link` | Create a relationship between nodes |
| `remove_link` | Remove a relationship |
| `list_links` | List all relationships |

### Session management
| Tool | Description |
|------|-------------|
| `start_session` | Start a tracked session for a project |
| `end_session` | End session with summary |
| `session_apply` | Reload map and detect new/modified nodes |
| `session_reload` | Re-read map from disk and check status |
| `mark_applied` | Mark nodes as done/delete/move after processing |
| `init_global_map` | Create the global preferences map |
| `migrate_memory` | Import markdown into a project map |

### Spec-kit
| Tool | Description |
|------|-------------|
| `sync_speckit` | Sync spec-kit features and tasks into the mindmap |
| `update_speckit_task` | Update task status, auto-complete features |

## Architecture

```
src/
├── index.ts              # MCP stdio entry point
├── server.ts             # MCP server setup, tool registration
├── storage.ts            # File system operations (~/.mindclaude/maps/)
├── model/
│   ├── types.ts          # MindMapDocument, MindMapNode, IdMapper
│   ├── mindmap.ts        # Document CRUD operations
│   └── id.ts             # 8-char nanoid short IDs
├── xmind/
│   ├── reader.ts         # .xmind → MindMapDocument
│   ├── writer.ts         # MindMapDocument → .xmind
│   └── format.ts         # XMind JSON schema types
├── render/
│   └── ascii.ts          # ASCII tree renderer
├── tools/
│   ├── map-lifecycle.ts  # Open/close/save/sync tools + shared state
│   ├── node-ops.ts       # Add/remove/move/edit node tools
│   ├── relationship-ops.ts
│   ├── navigation.ts     # Render/focus/fold/search tools
│   ├── session-ops.ts    # Session tracking + migration tools
│   └── speckit-ops.ts    # Spec-kit sync + task status tools
├── vault/
│   ├── storage.ts        # Vault filesystem paths
│   ├── format.ts         # YAML frontmatter ↔ node data
│   ├── sync.ts           # Bidirectional map ↔ vault sync
│   └── git-ops.ts        # Vault git commit/push/pull
├── web/
│   ├── index.ts          # Express server (port 3917)
│   ├── routes.ts         # REST API
│   ├── vault-routes.ts   # Vault REST API
│   ├── converter.ts      # jsMind ↔ MindMapDocument
│   └── git-ops.ts        # Git commit/push/pull/log
├── resources.ts          # MCP resources
└── prompts.ts            # MCP prompts

public/                   # Web UI (vanilla JS, no build step)
├── index.html            # Main mindmap editor
├── app.js
├── style.css
├── vault.html            # Vault notes browser (mobile-friendly)
├── vault.js
└── vault.css
```

## License

MIT
