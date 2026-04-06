# Operations Guide

Everything you need to install, run, and maintain Memex in practice — from first install to backup and debugging.

## Installation

### From npm

```bash
npm install -g memex
```

### From source

```bash
git clone <repo>
cd memex
npm install
npm run build
npm link  # makes 'memex' command available globally
```

## Running the daemon

The daemon requires `CAP_SYS_ADMIN` for mount namespace isolation.

### With systemd (production)

```bash
sudo cp systemd/memex.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now memex

# Check status
sudo systemctl status memex

# View logs
sudo journalctl -u memex -f
```

The systemd unit:
- Grants `CAP_SYS_ADMIN` via `AmbientCapabilities`
- Creates `/var/lib/memex` and `/run/memex` automatically
- Restarts on failure with 5s backoff
- Protects the host filesystem (`ProtectSystem=strict`)

### Manual (development)

```bash
sudo memex serve
```

Or with capability grants (avoids running as root):

```bash
sudo setcap cap_sys_admin+ep $(which node)
memex serve
```

### Environment overrides

For non-standard paths:

```bash
MEMEX_DATA_DIR=/opt/memex/data \
MEMEX_RUN_DIR=/opt/memex/run \
memex serve
```

## Wiki lifecycle

### Create

```bash
memex create research-wiki --name "Research Knowledge Base"
```

This:
1. Registers the wiki in SQLite
2. Creates the directory structure under `/var/lib/memex/wikis/research-wiki/`
3. Seeds default `.claude.md`, `_schema.md`, `_index.md`, `_log.md`
4. Validates the wiki directory exists

### Authenticate

**OAuth (recommended — uses your Claude subscription):**
```bash
memex login research-wiki
# Copies your local Claude credentials into the wiki
```

**API key (uses API credits):**
```bash
memex config research-wiki --set-key
# Paste your ANTHROPIC_API_KEY when prompted
```

**Global fallback:**
Set `ANTHROPIC_API_KEY` as an environment variable on the daemon. All wikis without their own credentials will use this.

### Configure

```bash
# Edit wiki conventions
memex config research-wiki --edit

# Change the model
memex config research-wiki --model opus

# View current config
memex config research-wiki
```

### Destroy

```bash
# Remove everything
memex destroy research-wiki

# Remove registration but keep files
memex destroy research-wiki --keep-data

# Skip confirmation
memex destroy research-wiki --yes
```

## Ingesting content

```bash
# Single file
memex ingest research-wiki paper.pdf

# Multiple files
memex ingest research-wiki notes.md report.pdf screenshot.png

# Non-blocking
memex ingest research-wiki paper.pdf --async
# Returns: Ingest job #42 submitted
# Check later: memex status research-wiki 42
```

Supported formats: anything `claude -p` can handle — markdown, PDF, HTML, plain text, images (PNG, JPG), etc.

Files are copied into the wiki's `wiki/raw/` directory with a timestamp prefix. The originals are never modified.

## Querying

```bash
# Blocking (waits for answer)
memex query research-wiki "What are the main findings across all papers?"

# Non-blocking
memex query research-wiki "Summarize the pricing analysis" --async
```

Answers are grounded in the wiki content. Claude cites specific files and flags gaps in coverage.

## Maintenance

```bash
# Manual lint
memex lint research-wiki

# Auto-lint runs automatically after every 10 ingests
```

The lint checks for:
- Contradictions between pages
- Orphan pages with no inbound links
- Missing cross-references
- Index entries that don't match content
- Schema conventions that have drifted

## Monitoring

```bash
# View audit log
memex logs research-wiki
memex logs research-wiki --tail 50

# Check job status
memex status research-wiki          # list recent jobs
memex status research-wiki 42       # specific job details

# List all wikis
memex list
```

## Debugging

### Check daemon status

```bash
# Is the daemon running?
curl --unix-socket /run/memex/memex.sock http://localhost/wikis 2>/dev/null
```

### View wiki directly

```bash
# Files are plain markdown on disk
ls /var/lib/memex/wikis/research-wiki/wiki/
cat /var/lib/memex/wikis/research-wiki/wiki/_index.md
```

### Common issues

**"CAP_SYS_ADMIN is required"**
The daemon needs namespace capabilities. Run with `sudo`, use systemd with `AmbientCapabilities`, or grant the capability to the Node.js binary.

**"Cannot connect to memex daemon"**
The daemon isn't running. Start it with `memex serve`.

**"No credentials configured"**
Run `memex login <wiki>` or `memex config <wiki> --set-key`.

**Jobs stuck in "pending"**
Check the daemon logs. The queue drains serially — a long-running job blocks subsequent ones for the same wiki.

## Backup

The entire state is in two locations:

- `/var/lib/memex/memex.db` — SQLite database (wiki registry, job history, audit log)
- `/var/lib/memex/wikis/` — Wiki files, credentials, configuration

Back up both. The wiki files are plain markdown — they work with git, rsync, or any file backup tool.

```bash
# Example: git-based backup
cd /var/lib/memex/wikis/research-wiki
git init && git add -A && git commit -m "backup"
```

## Resource usage

- **Disk:** Proportional to wiki size. Raw sources are copied, so expect ~2x the source size.
- **Memory:** The daemon itself is lightweight. Each `claude -p` process uses ~100-200MB.
- **CPU:** Minimal between jobs. During a job, the `claude` CLI handles API communication.
- **Network:** Only for Claude API calls. All wiki operations are local filesystem I/O.
- **Concurrency:** One active `claude -p` process per wiki. Multiple wikis run in parallel.
