import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { MemexClient } from '../client.js';

export const destroyCommand = new Command('destroy')
  .description('Destroy a wiki and its data')
  .argument('<wikiId>', 'Wiki to destroy')
  .option('--keep-data', 'Keep wiki files on disk (only remove registration)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (wikiId: string, opts: { keepData?: boolean; yes?: boolean }) => {
    if (!opts.yes) {
      const confirmed = await confirm(
        `This will destroy wiki '${wikiId}'${opts.keepData ? ' (keeping data)' : ' and ALL its data'}. Continue? [y/N] `
      );
      if (!confirmed) {
        console.log('Aborted.');
        process.exit(0);
      }
    }

    const client = new MemexClient();
    const resp = await client.destroyWiki(wikiId, opts.keepData ?? false);

    if (!resp.ok) {
      console.error(`Error: ${resp.error}`);
      process.exit(1);
    }

    console.log(`Destroyed wiki '${wikiId}'${opts.keepData ? ' (data preserved)' : ''}`);
  });

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
