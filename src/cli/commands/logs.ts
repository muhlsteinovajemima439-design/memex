import { Command } from 'commander';
import { MemexClient } from '../client.js';
import type { AuditEntry } from '../../lib/types.js';

export const logsCommand = new Command('logs')
  .description('View audit log for a wiki')
  .argument('<wikiId>', 'Target wiki')
  .option('--tail <n>', 'Number of entries to show', '20')
  .action(async (wikiId: string, opts: { tail: string }) => {
    const client = new MemexClient();
    const limit = parseInt(opts.tail, 10) || 20;

    const resp = await client.getAuditLog(wikiId, limit);
    if (!resp.ok) {
      console.error(`Error: ${resp.error}`);
      process.exit(1);
    }

    const entries = (resp.data ?? []) as AuditEntry[];
    if (entries.length === 0) {
      console.log('No audit log entries.');
      return;
    }

    // Print in chronological order (API returns newest first)
    for (const entry of entries.reverse()) {
      const detail = entry.detail ? ` — ${entry.detail}` : '';
      console.log(`[${entry.created_at}] ${entry.action}${detail}`);
    }
  });
