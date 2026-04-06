import { Command } from 'commander';
import { MemexClient } from '../client.js';

export const createCommand = new Command('create')
  .description('Create a new wiki')
  .argument('<wikiId>', 'Wiki identifier (lowercase alphanumeric + hyphens, 3-64 chars)')
  .option('--name <name>', 'Display name for the wiki')
  .action(async (wikiId: string, opts: { name?: string }) => {
    const client = new MemexClient();
    const resp = await client.createWiki(wikiId, opts.name);

    if (!resp.ok) {
      console.error(`Error: ${resp.error}`);
      process.exit(1);
    }

    const wiki = resp.data as { id: string; name: string; created_at: string };
    console.log(`Created wiki '${wiki.id}' (${wiki.name})`);
    console.log(`\nNext steps:`);
    console.log(`  memex login ${wiki.id}           # authenticate with Claude`);
    console.log(`  memex config ${wiki.id} --edit    # customize wiki agent`);
    console.log(`  memex ingest ${wiki.id} file.md   # add content`);
  });
