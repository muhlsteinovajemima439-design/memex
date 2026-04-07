import { Command } from 'commander';
import { MemexClient } from '../client.js';

const TOKEN_PREFIX = 'sk-ant-oat01-';

export const setupTokenCommand = new Command('setup-token')
  .description('Store a long-lived OAuth token from `claude setup-token` for all wikis')
  .argument('<token>', 'OAuth token (sk-ant-oat01-...)')
  .option('--wiki <wikiId>', 'Store for a specific wiki only (instead of globally)')
  .action(async (token: string, opts: { wiki?: string }) => {
    // Validate token format
    if (!token.startsWith(TOKEN_PREFIX)) {
      console.error(`Error: Token must start with '${TOKEN_PREFIX}'.`);
      console.error(`\nGenerate one by running: claude setup-token`);
      process.exit(1);
    }

    const client = new MemexClient();

    if (opts.wiki) {
      // Per-wiki token
      const wikiResp = await client.getWiki(opts.wiki);
      if (!wikiResp.ok) {
        console.error(`Error: ${wikiResp.error}`);
        process.exit(1);
      }

      const resp = await client.setWikiToken(opts.wiki, token);
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      console.log(`OAuth token stored for wiki '${opts.wiki}'.`);
    } else {
      // Global token
      const resp = await client.setGlobalToken(token);
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      console.log('Global OAuth token stored.');
      console.log('All wikis without per-wiki credentials will use this token.');
    }
  });
