import { Command } from 'commander';
import { MemexClient } from '../client.js';
import type { Wiki } from '../../lib/types.js';

export const listCommand = new Command('list')
  .description('List all wikis')
  .action(async () => {
    const client = new MemexClient();
    const resp = await client.listWikis();

    if (!resp.ok) {
      console.error(`Error: ${resp.error}`);
      process.exit(1);
    }

    const wikis = (resp.data ?? []) as Wiki[];
    if (wikis.length === 0) {
      console.log('No wikis. Create one with: memex create <wikiId>');
      return;
    }

    // Print as table
    const header = padRow('ID', 'NAME', 'MODEL', 'CREATED');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const wiki of wikis) {
      console.log(padRow(wiki.id, wiki.name, wiki.default_model, wiki.created_at));
    }
  });

function padRow(id: string, name: string, model: string, created: string): string {
  return `${id.padEnd(24)} ${name.padEnd(24)} ${model.padEnd(10)} ${created}`;
}
