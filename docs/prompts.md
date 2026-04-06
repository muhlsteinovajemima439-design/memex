# Prompt Design

The prompts are what make Memex a disciplined wiki curator rather than a generic chatbot. Every sentence in the system prompt is a product decision — it shapes whether the LLM creates useful cross-references, maintains the index, notices contradictions, or lets things drift. Edit with the same care as a core algorithm.

## Prompt architecture

There are two layers of prompts:

1. **System prompt** (`lib/prompts/wiki.ts`) — Injected via `--append-system-prompt` on every `claude -p` invocation. Defines the wiki agent's core identity and responsibilities. Not stored as `.claude.md` — passed explicitly for full control.

2. **Job prompts** (`lib/prompts/ingest.ts`, `query.ts`, `lint.ts`) — Passed as the `-p` argument. Tell Claude what to do with this specific input. The system prompt provides context for *how* to do it.

3. **Wiki conventions** (`.claude.md`) — Auto-discovered by Claude Code. Extends the base system prompt with wiki-specific customization. Users edit this directly.

The context ordering is deliberate: schema first (institutional memory), index second (map of territory), then the task. The LLM orients before diving in.

## System prompt philosophy

The system prompt sets the frame: Claude is a **curator of a living knowledge base**, not a filing clerk. On every call, it thinks about:

1. What does this source add to what we already know?
2. Does it confirm, extend, or contradict existing understanding?
3. Which existing pages need to know about this?
4. Are there patterns emerging that deserve their own page?
5. Should any conventions be updated?

### Core responsibilities

1. **Schema ownership** — `_schema.md` is the LLM's institutional memory. It creates, maintains, and evolves filing conventions, categories, naming patterns, domain vocabulary.

2. **Index maintenance** — `_index.md` must always be current. Every page gets a one-line summary. A reader should understand the shape of the entire knowledge base from the index alone.

3. **Bidirectional connections** — Every page has a `## Related` section with labeled links. If A links to B, B must link back to A. This is the bookkeeping that humans abandon — the LLM does it every call.

4. **Activity log** — `_log.md` gets an entry after every operation.

5. **Contradiction handling** — When new info conflicts with existing pages, UPDATE the existing page. Never file contradictory claims in separate pages without acknowledging the conflict.

6. **Look-up before write** — Always search before creating. Prefer updating existing pages over creating duplicates. The knowledge base should grow deeper, not just wider.

7. **Source references** — Every wiki page references its raw sources for provenance.

8. **Ongoing tuning** — Notice patterns. Split broad categories. Create synthesis pages. Fix drift. Evolve the schema.

## Job prompts

### Ingest

The ingest prompt tells Claude to:
1. Read the raw source files
2. Read schema and index for conventions and existing content
3. Search for related existing content
4. Create or update wiki pages
5. Maintain bidirectional cross-references
6. Update the index
7. Append to the activity log

Returns structured JSON: `{ summary, operations: [{ action, path, reason }] }`

The **reason** field is important — it should articulate what the operation *adds to the knowledge base*, not just the mechanics. "Created new customer file" is useless. "First signal from a fintech customer — establishes a new vertical" is insight. These reasons flow into the audit log and become a narrative of how the knowledge base evolved.

### Query

The query prompt frames Claude as "the voice of the knowledge base":

- Only reference information in the wiki. Never use training data for facts.
- Cite specific file paths.
- Note contradictions between pages.
- Flag thin coverage areas.
- Offer to file synthesis as a new wiki page when the answer combines multiple sources.

### Lint

The lint prompt runs an 8-point health check:

1. Contradictions
2. Stale claims
3. Orphan pages
4. Missing pages (concepts mentioned but without their own page)
5. Duplicate pages
6. Missing cross-references
7. Index accuracy
8. Schema drift

Confident fixes are applied directly. Judgment calls are flagged for human review.

## Customization via `.claude.md`

The base system prompt handles core wiki behavior. `.claude.md` is for wiki-specific customization:

```markdown
# Wiki Agent — Conventions

## Domain
This knowledge base tracks competitive intelligence in the SaaS analytics space.

## Conventions
- Organize competitors under competitors/{name}.md
- Track pricing changes with dates
- Flag acquisitions and funding rounds prominently
- Use "## Pricing" as a standard section in competitor pages

## Things to ignore
- Job postings
- Social media noise without substance
```

Edit with `memex config <wiki> --edit`.

## Testing prompts

Prompt changes are the highest-leverage changes in the product. Testing approach:

1. **Curated test sources.** 5-10 documents that exercise different scenarios: new entity, returning entity, contradictory information, vague signals.

2. **Sequential processing.** Process sources in order, building up the knowledge base. Does the 5th source correctly reference pages created by the 1st?

3. **Evaluation criteria** (per-source):
   - Did the LLM find and update existing files? (lookup-before-write)
   - Did it create/update cross-references? (bidirectional connections)
   - Did it update the index? (index maintenance)
   - Did it update the schema when appropriate? (schema evolution)
   - Are the "reason" fields insightful? (not mechanical)
   - Would a reader find the output useful? (readability)

4. **What "good" looks like** after 5 sequential ingests:
   - The index has a one-line summary for every page
   - The schema documents at least 3 wiki-specific conventions
   - Every page has a Related section with at least one labeled connection
   - At least one contradiction or confirmation has been explicitly noted
   - A reader can understand the landscape from the index alone

## Evolving prompts

The prompts in `lib/prompts/` are stubs that encode the right philosophy. As you use Memex, you'll want to tune them for your domain:

- If the LLM creates too many cross-references, tighten the criteria
- If index summaries are too verbose, add length constraints
- If schema updates are too frequent, add a stability threshold
- If reason fields are mechanical, add examples of good reasons

Document iterations alongside your wiki. The prompt is the product.
