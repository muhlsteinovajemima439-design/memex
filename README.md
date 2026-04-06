# Memex

Isolated, queued `claude -p` runtime for persistent knowledge bases.

Each wiki gets its own filesystem namespace, job queue, and customizable Claude configuration. A privileged daemon handles namespace isolation and process spawning; unprivileged users interact through the `memex` CLI.

## Why

`claude -p` gives you something the API can't: Claude Code's full file tool suite (Read, Write, Edit, Glob, Grep) running natively against a real filesystem. The wiki IS the filesystem, and Claude operates on it with the same tools a human developer would use.

The tradeoff is that `claude -p` is single-threaded and process-heavy. Memex compensates with per-wiki queuing and namespace isolation rather than fighting the CLI's concurrency model.

## Quick start

```bash
# Install
npm install -g memex

# Start the daemon (requires CAP_SYS_ADMIN for namespace isolation)
sudo memex serve

# Create a wiki
memex create my-wiki --name "My Knowledge Base"

# Authenticate Claude for this wiki
memex login my-wiki

# Ingest a document
memex ingest my-wiki notes.md report.pdf

# Ask a question
memex query my-wiki "What are the key themes across these documents?"

# Run a health check
memex lint my-wiki
```

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│  CLI (unprivileged)                                          │
│                                                              │
│  memex ingest acme notes.md                                  │
│       │                                                      │
│       ▼                                                      │
│  /run/memex/memex.sock  ─────────────────────────────────    │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  DAEMON (memex serve)                            privileged  │
│                                                              │
│  Per-Wiki Job Queues          Wiki Registry (SQLite)         │
│  ┌─────────────────┐        ┌─────────────────────┐         │
│  │ acme: [▶ingest]  │        │ wikis, jobs, audit  │         │
│  │ beta: (idle)     │        └─────────────────────┘         │
│  └────────┬────────┘                                         │
│           │                                                  │
│           ▼                                                  │
│  unshare -m -- mount --bind .../wikis/acme /workspace \      │
│    claude -p "..." --tools Read,Write,Edit,Glob,Grep         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  MOUNT NAMESPACE — what Claude sees                    │  │
│  │  /workspace/                                           │  │
│  │    .claude.md        wiki/_schema.md                   │  │
│  │    .claude/          wiki/_index.md                    │  │
│  │    .tools/           wiki/_log.md                      │  │
│  │    wiki/             wiki/raw/                         │  │
│  │                                                        │  │
│  │  No /home. No /etc. No other wikis.                    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Serialize, don't parallelize.** Each wiki's queue processes jobs one at a time. This prevents concurrent writes to the same wiki files. Independent wikis run in parallel.

**Isolation through namespaces, not containers.** Mount namespaces give you filesystem isolation without Docker's overhead. Claude cannot see the host filesystem, other wikis, or anything outside `/workspace`.

## Commands

| Command | Description |
|---------|-------------|
| `memex serve` | Start the daemon |
| `memex create <wiki> [--name "..."]` | Create a new wiki |
| `memex destroy <wiki> [--keep-data]` | Destroy a wiki |
| `memex config <wiki> --edit` | Open `.claude.md` in `$EDITOR` |
| `memex config <wiki> --set-key` | Set API key for this wiki |
| `memex config <wiki> --model opus` | Set default model |
| `memex login <wiki>` | Authenticate Claude (OAuth) |
| `memex ingest <wiki> <files...>` | Ingest source files into the wiki |
| `memex query <wiki> "question"` | Ask a question against the wiki |
| `memex lint <wiki>` | Run wiki health check |
| `memex logs <wiki> [--tail N]` | View audit log |
| `memex list` | List all wikis |
| `memex status <wiki> [jobId]` | Check job status |

Most commands block until the job completes. Pass `--async` to get a job ID and check status later.

## Architecture

### Per-wiki workspace

Each wiki gets an isolated directory:

```
/var/lib/memex/wikis/{wikiId}/
  .claude.md              # Wiki-specific Claude conventions (user-editable)
  .claude/                # Claude credentials (per-wiki, isolated)
  .tools/
    mcp.json              # MCP server configuration (optional)
    allowed-tools.txt     # Extra tools beyond the base set (optional)
  wiki/
    _schema.md            # Filing conventions — the LLM's institutional memory
    _index.md             # Table of contents — one-line summary of every page
    _log.md               # Chronological activity log
    raw/                  # Immutable source documents (never modified by Claude)
    themes/               # (example — categories emerge from content)
    customers/
    ...
```

### Three layers

1. **Raw sources** (`wiki/raw/`) — Immutable. Claude reads from them but never modifies them. Your source of truth.
2. **The wiki** (`wiki/`) — LLM-generated markdown. Summaries, entity pages, concept pages, cross-references. Claude owns this layer entirely.
3. **The schema** (`_schema.md`, `.claude.md`) — How the wiki is structured, what conventions to follow. Co-evolved by user and LLM.

### Job types

| Type | What it does | Max turns | Timeout |
|------|-------------|-----------|---------|
| `ingest` | Process raw sources into wiki pages | 25 | 5 min |
| `query` | Search wiki and answer a question | 15 | 2 min |
| `lint` | Health check — find and fix issues | 30 | 10 min |

### Auto-lint

After every 10 ingests (configurable), the daemon automatically queues a lint job. This keeps the wiki healthy as it grows — finding contradictions, orphan pages, missing cross-references, and index drift.

## Security

**Namespace isolation** prevents Claude from accessing files outside the wiki's directory. This is the primary security boundary.

**Tool restriction** — Only `Read`, `Write`, `Edit`, `Glob`, `Grep` are available by default. No `Bash` (shell escape), no `WebSearch`/`WebFetch` (external calls), no `Agent` (sub-agents). Users can opt into higher-risk tools per-wiki via `.tools/allowed-tools.txt`.

**Per-wiki credentials** — Each wiki gets its own Claude authentication. Credentials are stored in the wiki's `.claude/` directory, isolated by the mount namespace.

**Audit log** — Every operation is recorded with the wiki, action, and detail.

## Credential setup

Each wiki needs Claude credentials. Three options:

**Copy existing OAuth credentials (recommended):**
```bash
# Uses ~/.claude/.credentials.json by default
memex login my-wiki

# Or specify a path
memex login my-wiki --credentials /path/to/.credentials.json
```

If you've already run `claude auth login` on this machine, your credentials are at `~/.claude/.credentials.json`. This copies them into the wiki's isolated config directory.

**API key:**
```bash
memex login my-wiki --api-key sk-ant-...
```

**Global fallback:**
```bash
# Set on the daemon's environment (e.g. in the systemd unit)
Environment=ANTHROPIC_API_KEY=sk-ant-...
```

Credentials are checked in order: per-wiki API key > per-wiki OAuth > global `ANTHROPIC_API_KEY` env var on the daemon.

## Customization

### `.claude.md`

The most important customization point. This file is auto-discovered by Claude Code and extends the base system prompt. Use it to define:

- Domain vocabulary
- Filing conventions specific to your wiki
- Categories and page structures
- What to ignore or deprioritize
- How to handle specific types of content

```bash
memex config my-wiki --edit
```

### `.tools/mcp.json`

Add external data sources via MCP servers:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/mcp-server"],
      "env": { "NOTION_API_KEY": "secret_..." }
    }
  }
}
```

### `.tools/allowed-tools.txt`

Extend the tool set beyond the safe defaults:

```
Bash
WebSearch
```

Use with caution — `Bash` gives Claude shell access inside the namespace.

## Deployment

### systemd (recommended)

```bash
sudo cp systemd/memex.service /etc/systemd/system/
sudo systemctl enable --now memex
```

The unit file grants `CAP_SYS_ADMIN` via `AmbientCapabilities` and creates the required directories automatically.

```bash
# Lifecycle
systemctl start memex        # Start the daemon
systemctl stop memex         # Graceful shutdown (finishes current job)
systemctl restart memex      # Stop + start
journalctl -u memex -f       # Tail logs

# Status
systemctl status memex       # Process state, recent log lines
```

### Why `memex serve` blocks

`memex serve` runs in the foreground deliberately. This is the standard pattern for systemd-managed daemons:

- **systemd owns the lifecycle** — backgrounding, restarts, boot ordering, and capability grants are its job, not the application's.
- **Logging is automatic** — stdout/stderr go straight to `journalctl`. No log file management needed.
- **Graceful shutdown works** — systemd sends SIGTERM, the daemon finishes the current job, closes the socket, and exits cleanly.
- **`Type=simple`** — systemd tracks the exact PID it spawned. Self-daemonizing (double-fork) breaks this and is a legacy SysV init pattern.

If you're running without systemd (development, containers), just background it yourself:

```bash
sudo memex serve &            # Background in shell
sudo memex serve &>/dev/null &  # Silent background
```

### Manual

```bash
sudo memex serve
```

Requires root or `CAP_SYS_ADMIN` for mount namespace creation.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMEX_DATA_DIR` | `/var/lib/memex` | Data directory (wikis, database) |
| `MEMEX_RUN_DIR` | `/run/memex` | Runtime directory (socket, namespaces) |
| `MEMEX_SOCKET_PATH` | `/run/memex/memex.sock` | Unix socket path |
| `ANTHROPIC_API_KEY` | — | Global fallback API key |

## Requirements

- Node.js >= 20
- Linux with mount namespace support (`unshare`, `nsenter` from util-linux)
- `CAP_SYS_ADMIN` capability (or root)
- `claude` CLI installed and in `$PATH`

## The idea

Related in spirit to Vannevar Bush's Memex (1945) — a personal, curated knowledge store with associative trails between documents. The part Bush couldn't solve was who does the maintenance. The LLM handles that.

Most people's experience with LLMs and documents is RAG: retrieve chunks, generate answers, forget everything. Nothing compounds. Memex is different — the LLM incrementally builds and maintains a persistent wiki. The cross-references are already there. The contradictions have been flagged. The synthesis reflects everything ingested. Every source makes the whole richer.

You never write the wiki yourself. You source, explore, and ask questions. The LLM does the summarizing, cross-referencing, filing, and bookkeeping that makes a knowledge base actually useful over time.
