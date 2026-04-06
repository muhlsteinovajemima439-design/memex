import { Command } from 'commander';
import { MemexClient } from '../client.js';
import type { Wiki } from '../../lib/types.js';

export const chownCommand = new Command('chown')
  .description('Transfer wiki ownership to another user (by UID)')
  .argument('<wikiId>', 'Wiki identifier')
  .argument('<uid>', 'New owner UID (numeric)')
  .action(async (wikiId: string, uidStr: string) => {
    const uid = Number(uidStr);
    if (!Number.isInteger(uid) || uid < 0) {
      console.error(`Error: uid must be a non-negative integer, got '${uidStr}'`);
      process.exit(1);
    }

    const client = new MemexClient();
    const resp = await client.chownWiki(wikiId, uid);

    if (!resp.ok) {
      console.error(`Error: ${resp.error}`);
      process.exit(1);
    }

    const wiki = resp.data as Wiki;
    console.log(`Transferred wiki '${wiki.id}' to uid ${wiki.owner_uid}`);
  });
