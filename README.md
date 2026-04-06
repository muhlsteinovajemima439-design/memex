# Memex

**Stop re-discovering what you already know.** Memex is an LLM runtime that builds and maintains a personal wiki from your raw sources — so the knowledge compounds instead of disappearing into chat history.

## The problem

Most people's experience with LLMs and documents looks like RAG: upload files, retrieve chunks, generate an answer, forget everything. Ask the same subtle question tomorrow and the LLM starts from scratch. Nothing accumulates. There's no memory between sessions, no synthesis across sources, no evolving understanding. Your tenth conversation is no smarter than your first.

## The idea

Instead of retrieving from raw documents at query time, Memex has the LLM **incrementally build and maintain a persistent wiki** — a structured, interlinked collection of markdown files that sits between you and your sources.

When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening the evolving synthesis. The knowledge is compiled once and kept current.

**The wiki is a persistent, compounding artifact.** The cross-references are already there. The contradictions have been flagged. The synthesis reflects everything you've ingested. Every source makes the whole richer. Every question you ask can be filed back as a new page, so your explorations compound too.

You never write the wiki yourself. You source, explore, and ask questions. The LLM does the summarizing, cross-referencing, filing, and bookkeeping that makes a knowledge base actually useful over time. The tedious part of maintaining a knowledge base isn't the reading or the thinking — it's the bookkeeping. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass.

This can apply to anything where you accumulate knowledge over time:

- **Research** — reading papers over weeks, building up an evolving synthesis with citations and cross-references
- **Reading a book** — filing each chapter, building out pages for characters, themes, and plot threads as you go
- **Business intelligence** — competitive analysis, customer signals, market trends fed from Slack, calls, and reports
- **Personal** — health, goals, self-improvement, journal entries, podcast notes, building a structured picture of yourself
- **Learning** — course notes, hobby deep-dives, trip planning, anything you want organized rather than scattered

The idea is related in spirit to Vannevar Bush's [Memex](https://en.wikipedia.org/wiki/Memex) (1945) — a personal, curated knowledge store with associative trails between documents. Bush's vision was closer to this than to what the web became: private, actively curated, with the connections between documents as valuable as the documents themselves. The part he couldn't solve was who does the maintenance. The LLM handles that.

## Why Memex

**Just files, no RAG.** The wiki is a directory of markdown files. No vector databases, no embeddings, no retrieval pipelines. Claude is already smart enough to grep through files, read what's relevant, and figure out what to update. The simplest architecture that works.

**Safe by default.** Each wiki runs in its own Linux mount namespace — Claude can only see `/workspace`, not your home directory, not other wikis, not the host filesystem. No Docker required. Tool access is restricted to file operations (Read, Write, Edit, Glob, Grep) unless you explicitly opt in to more.

**CLI-first.** Everything is a single command: `memex ingest`, `memex query`, `memex lint`. Runs from your existing Claude machine. No web UI to host, no API keys to juggle beyond what you already have for Claude.

**Feed it from anywhere.** Ingest markdown, PDFs, HTML, images, plain text — anything Claude can read. Clip web articles with Obsidian Web Clipper, pipe in Slack exports, drop in meeting transcripts. Add MCP servers to pull directly from Notion, Google Drive, or any app with an API. Local files or remote sources, it all compiles into the same wiki.

**Fully yours to shape.** Edit `.claude.md` to change how the LLM thinks about your domain. Whitelist extra tools. Swap models. The prompts, conventions, and filing structure are all configurable — the wiki evolves with you, not against a fixed template.

## What Memex does

Memex wraps `claude -p` (Claude Code's programmatic mode) into a daemon that gives each wiki its own isolated filesystem, job queue, and configuration. Claude operates on the wiki with the same file tools a developer would use — Read, Write, Edit, Glob, Grep — against a real filesystem of markdown files.

Three layers:

1. **Raw sources** — your curated collection of articles, papers, images, data files. Immutable. The LLM reads them but never modifies them.
2. **The wiki** — LLM-generated markdown. Summaries, entity pages, concept pages, cross-references, an index. The LLM owns this layer entirely.
3. **The schema** — conventions for how the wiki is structured. Co-evolved by you and the LLM over time.

Three operations:

- **Ingest** — drop a source in, the LLM reads it, writes a summary, updates the index, and touches every related page across the wiki.
- **Query** — ask a question, the LLM searches the wiki and synthesizes an answer grounded in your accumulated knowledge. Good answers get filed back as new pages.
- **Lint** — health-check the wiki. Find contradictions, orphan pages, missing cross-references, stale claims. The LLM fixes what it can and flags what needs your judgment.

## Quick start

```bash
# Install
npm install -g @wastedcode/memex

# Start the daemon (requires CAP_SYS_ADMIN for namespace isolation)
sudo memex serve

# Create a wiki
memex create my-wiki --name "My Knowledge Base"

# Authenticate Claude for this wiki
memex login my-wiki

# Ingest some sources
memex ingest my-wiki paper.pdf notes.md article.html

# Ask a question
memex query my-wiki "What are the key themes across these documents?"

# Run a health check
memex lint my-wiki
```

## Commands

| Command | Description |
|---------|-------------|
| `memex serve` | Start the daemon |
| `memex create <wiki>` | Create a new wiki |
| `memex destroy <wiki>` | Destroy a wiki |
| `memex config <wiki> --edit` | Edit wiki conventions in `$EDITOR` |
| `memex config <wiki> --set-key` | Set API key |
| `memex config <wiki> --model opus` | Set default model |
| `memex login <wiki>` | Authenticate Claude (OAuth) |
| `memex ingest <wiki> <files...>` | Ingest source documents |
| `memex query <wiki> "question"` | Ask a question against the wiki |
| `memex lint <wiki>` | Run wiki health check |
| `memex logs <wiki>` | View audit log |
| `memex list` | List all wikis |
| `memex status <wiki>` | Check job status |

Most commands block until complete. Pass `--async` to get a job ID and check status later.

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

Each wiki's queue processes jobs serially — no concurrent writes. Independent wikis run in parallel. Mount namespaces provide filesystem isolation without Docker overhead.

## Customization

### Wiki conventions (`.claude.md`)

The most important customization point. This file extends the base system prompt with domain-specific behavior:

```markdown
# Wiki Conventions

## Domain
This knowledge base tracks competitive intelligence in the SaaS analytics space.

## Filing conventions
- Organize competitors under competitors/{name}.md
- Track pricing changes with dates
- Flag acquisitions and funding rounds prominently

## Things to ignore
- Job postings
- Social media noise without substance
```

Edit with `memex config my-wiki --edit`.

### MCP servers (`.tools/mcp.json`)

Connect external data sources:

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

### Tool whitelist (`.tools/allowed-tools.txt`)

By default, Claude only gets safe file tools. Opt into more:

```
Bash
WebSearch
```

## Requirements

- Node.js >= 20
- Linux with mount namespace support
- `CAP_SYS_ADMIN` capability (or root)
- `claude` CLI installed and in `$PATH`

## Documentation

- **[Architecture](docs/architecture.md)** — design principles, components, data flow, filesystem layout
- **[Operations](docs/operations.md)** — installation, deployment, wiki lifecycle, debugging
- **[Prompt design](docs/prompts.md)** — how the system prompt, job prompts, and conventions work together

## License

MIT
