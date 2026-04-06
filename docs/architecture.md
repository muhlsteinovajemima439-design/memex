# Architecture

Memex wraps `claude -p` into a daemon that gives each wiki isolated filesystem access, queued job processing, and per-wiki configuration. This document covers the internals — how the pieces fit together and why they're designed this way.

## Design principles

1. **Keep the CLI.** Don't replace `claude -p` with raw API calls. The file tools are the product.
2. **Serialize, don't parallelize.** Each wiki's queue processes jobs one at a time. This prevents concurrent writes to the same wiki files.
3. **Isolation through namespaces, not containers.** Mount namespaces give you filesystem isolation without Docker's overhead.
4. **The prompt is the product.** Every sentence in the system prompt is a product decision. Edit with the same care as a core algorithm.
5. **User-customizable behavior.** Each wiki controls its own `.claude.md`, tool whitelist, and MCP configuration.

## System overview

```
                    ┌──────────┐
                    │  memex   │  unprivileged CLI
                    │  (user)  │
                    └────┬─────┘
                         │ JSON over Unix socket
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  memex serve                                    privileged  │
│                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │  HTTP     │   │  Per-Wiki    │   │  SQLite          │   │
│  │  Server   │──▶│  Job Queues  │──▶│  (persistence)   │   │
│  │  (socket) │   │              │   │                  │   │
│  └──────────┘   └──────┬───────┘   └──────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Claude Runner                                       │  │
│  │                                                      │  │
│  │  unshare -m -- mount --bind .../wikis/{wiki} \       │  │
│  │    claude -p "{prompt}" \                            │  │
│  │    --tools Read,Write,Edit,Glob,Grep \               │  │
│  │    --allowedTools Read,Write,Edit,Glob,Grep \        │  │
│  │    --model sonnet \                                  │  │
│  │    --max-turns 25 \                                  │  │
│  │    --append-system-prompt "{wiki_prompt}"             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Daemon (`src/daemon.ts`)

Entry point. Wires everything together:

1. Opens SQLite database, runs migrations
2. Checks for `CAP_SYS_ADMIN` capability
3. Rebuilds mount namespaces for all registered wikis
4. Starts HTTP server on Unix socket
5. Starts queue drain loops
6. Registers SIGTERM/SIGINT handlers for graceful shutdown

### HTTP Server (`src/daemon/server.ts`)

Node.js `http.createServer` listening on a Unix domain socket at `/run/memex/memex.sock`. Handles JSON request/response with simple regex-based routing. No framework dependencies.

Debug with curl:
```bash
curl --unix-socket /run/memex/memex.sock http://localhost/wikis
```

### Routes (`src/daemon/routes.ts`)

12 API routes:

```
POST   /wikis                    Create wiki
GET    /wikis                    List wikis
GET    /wikis/:id                Get wiki details
DELETE /wikis/:id                Destroy wiki
PUT    /wikis/:id/config         Update config
POST   /wikis/:id/chown          Transfer ownership
POST   /wikis/:id/api-key        Set API key
POST   /wikis/:id/credentials    Set OAuth credentials
POST   /wikis/:id/jobs           Submit job
GET    /wikis/:id/jobs/:jobId    Get job status
GET    /wikis/:id/jobs           List jobs
GET    /wikis/:id/logs           Audit log
POST   /wikis/:id/ingest-file    Upload file for ingestion
```

### Database (`src/daemon/db.ts`)

SQLite via `better-sqlite3` (synchronous API, ideal for single-process daemon). Three tables:

- **wikis** — id, name, default_model, created_at
- **queue_jobs** — id, wiki_id, type, payload (JSON), status, retry_count, timestamps, result (JSON)
- **audit_log** — id, wiki_id, action, detail, created_at

Key operations:
- `claimNextJob(wikiId)` — atomic UPDATE...RETURNING to dequeue
- `resetStaleJobs()` — on startup, reset `running` jobs back to `pending`

### Namespace Manager (`src/daemon/namespace.ts`)

Linux mount namespace lifecycle:

- `checkCapabilities()` — test `unshare -m` works, fail with actionable error if not
- `validateWiki(wikiId)` — verify the wiki's directory exists
- `wrapCommand(wikiId, innerCommand)` — wrap a command in `unshare -m` + `mount --bind`

### Queue Manager (`src/daemon/queue.ts`)

Per-wiki FIFO queue with in-memory state backed by SQLite:

- Wikis drain in parallel (independent)
- Jobs within a wiki drain serially (prevents concurrent writes)
- `notify(wikiId)` — wake the drain loop if not already active
- Auto-lint: after every N ingests, queue a lint job

### Claude Runner (`src/daemon/runner.ts`)

Spawns `claude -p` inside a wiki's namespace:

1. Build prompt from job type + payload
2. Resolve credentials (per-wiki API key > OAuth > global key)
3. Resolve tools (base set + user-allowed extras)
4. Spawn via `unshare -m -- mount --bind ... -- claude -p ...`
5. Enforce timeout: SIGTERM → 5s grace → SIGKILL
6. Parse JSON output, return result

Environment isolation:
- Only `PATH`, `LANG`, `LC_ALL`, `TERM`, `NODE_ENV` from host
- `CLAUDE_CONFIG_DIR` pointed at wiki's `.claude/` dir
- `HOME` set to `/workspace`

### Auth Manager (`src/daemon/auth.ts`)

Credential resolution chain:
1. Per-wiki API key file (`.claude/api-key`)
2. Per-wiki OAuth credentials (`.claude/.credentials.json`)
3. Global `ANTHROPIC_API_KEY` from daemon env

### CLI Client (`src/cli/client.ts`)

HTTP client over Unix socket. Convenience methods for every API route. Includes:
- `waitForJob()` — poll until completed/failed
- `uploadFile()` — read local file, base64-encode, POST to daemon
- `stream()` — async iterable for streaming responses (login flow)

## Data flow

### Ingest

```
User: memex ingest acme report.pdf
  │
  ├─ CLI reads report.pdf from local disk
  ├─ POST /wikis/acme/ingest-file (base64 content)
  │    └─ Daemon writes to /var/lib/memex/wikis/acme/wiki/raw/20260406T120000-report.pdf
  ├─ POST /wikis/acme/jobs {type: "ingest", payload: {files: [...]}}
  │    └─ Job inserted into SQLite, queue notified
  ├─ Queue drains → Runner spawns claude -p inside namespace
  │    └─ Claude reads raw file, reads schema/index, searches wiki
  │    └─ Claude creates/updates wiki pages, updates index, appends to log
  │    └─ Claude outputs JSON: {summary, operations}
  └─ CLI polls until complete, prints result
```

### Query

```
User: memex query acme "What themes emerge from the research?"
  │
  ├─ POST /wikis/acme/jobs {type: "query", payload: {question: "..."}}
  ├─ Queue drains → Runner spawns claude -p
  │    └─ Claude reads _index.md, searches wiki, reads relevant pages
  │    └─ Claude synthesizes answer grounded in wiki content
  └─ CLI polls until complete, prints answer
```

## Filesystem layout

### Host

```
/var/lib/memex/                      MEMEX_DATA_DIR
  memex.db                           SQLite
  wikis/
    {wikiId}/                        One per wiki
      .claude.md                     User conventions
      .claude/                       Claude config (credentials)
      .tools/                        MCP config, extra tools
      wiki/                          The knowledge base
        _schema.md                   Filing conventions
        _index.md                    Table of contents
        _log.md                      Activity log
        raw/                         Immutable sources

/run/memex/                          MEMEX_RUN_DIR (tmpfs)
  memex.sock                         Unix domain socket
```

### Inside namespace (what Claude sees)

```
/workspace/
  .claude.md
  .claude/
  .tools/
  wiki/
    _schema.md  _index.md  _log.md  raw/  ...
```

## Restart behavior

| Layer | Location | Survives restart? | Recovery |
|-------|----------|-------------------|----------|
| Wiki files | `/var/lib/memex/wikis/` | Yes | Files on disk |
| Database | `/var/lib/memex/memex.db` | Yes | Wikis, queue, audit |
| Namespaces | (per-job, ephemeral) | N/A | Created per job |
| In-memory queues | Process memory | No | Re-loaded from SQLite |
| Unix socket | `/run/memex/memex.sock` | No | Re-created on startup |

Jobs that were `running` when the daemon died are reset to `pending` and re-queued.
