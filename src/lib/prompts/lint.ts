/**
 * Build the prompt for a lint/maintenance job.
 *
 * Claude examines the knowledge base holistically. Finds contradictions,
 * stale claims, orphan pages, missing connections. Applies confident fixes
 * directly, flags everything else in a report.
 */
export function buildLintPrompt(): string {
  const date = new Date().toISOString().split('T')[0];

  return `Perform a thorough health check on this knowledge base. Today is ${date}.

Read all wiki files (glob **/*.md, excluding raw/) and check for:

1. **Contradictions** — pages making conflicting claims about the same entity or fact
2. **Stale claims** — date-stamped statements that may no longer be current
3. **Orphan pages** — pages with no inbound links from other pages' ## Related sections
4. **Missing pages** — concepts mentioned across multiple pages that deserve their own page
5. **Duplicate pages** — topics covered by two pages that should be merged
6. **Missing cross-references** — pages discussing entities with their own pages but not linking
7. **Index accuracy** — _index.md entries that don't match file content, or missing entries
8. **Schema drift** — actual patterns that don't match _schema.md conventions

For issues you're CONFIDENT about, fix them directly:
- Add missing cross-references and ## Related links (bidirectional)
- Correct _index.md entries
- Add ## Related sections to pages that lack them
- Fix schema drift in _schema.md

For issues requiring human judgment (contradictions, merges, stale facts), note them in your report but do NOT change the files.

Do NOT rewrite pages for style — only fix semantic issues.

After making fixes, append a lint entry to _log.md.

Output a markdown health check report:

# Knowledge Base Health Check — ${date}

## Contradictions
(numbered list with specific pages and quotes)

## Stale Claims
(numbered list with page, claim, and age)

## Orphan Pages
(list with page path and suggested connections)

## Missing Cross-References
(specific A→B links that should exist)

## Auto-Fixes Applied
(list of changes you made directly)

## Flagged for Review
(issues needing human judgment)

## Statistics
- Total pages: N
- Pages with ## Related: N
- Orphan pages: N`;
}
