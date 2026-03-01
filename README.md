# MindClaude

MCP server + web UI for mindmap-based structured thinking in Claude Code. Maps are stored as standard `.xmind` files.

## What it does

- **MCP Server** (stdio) — 25 tools for creating, editing, navigating, and searching mindmaps directly from Claude Code
- **Web UI** — browser-based mindmap editor with jsMind, keyboard shortcuts, version history, find, themes
- **Session tracking** — `start_session` / `end_session` tools that track what changed between Claude Code conversations
- **Git-backed** — every save creates a git commit; optional push to a remote

## Quick start

```bash
git clone https://github.com/rafal-willautomate/mindclaude.git
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
| `init_global_map` | Create the global preferences map |
| `migrate_memory` | Import markdown into a project map |

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
│   └── session-ops.ts    # Session tracking + migration tools
├── web/
│   ├── index.ts          # Express server (port 3917)
│   ├── routes.ts         # REST API
│   ├── converter.ts      # jsMind ↔ MindMapDocument
│   └── git-ops.ts        # Git commit/push/pull/log
├── resources.ts          # MCP resources
└── prompts.ts            # MCP prompts

public/                   # Web UI (vanilla JS, no build step)
├── index.html
├── app.js
└── style.css
```

## License

MIT
