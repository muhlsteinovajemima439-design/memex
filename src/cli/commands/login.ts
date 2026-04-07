import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { MemexClient } from '../client.js';

const DEFAULT_CREDS_PATH = join(homedir(), '.claude', '.credentials.json');

export const loginCommand = new Command('login')
  .description('Copy Claude credentials into a wiki')
  .argument('<wikiId>', 'Wiki to authenticate')
  .option('--credentials <path>', 'Path to .credentials.json', DEFAULT_CREDS_PATH)
  .option('--token <token>', 'Use an OAuth token from `claude setup-token`')
  .action(async (wikiId: string, opts: { credentials: string; token?: string }) => {
    const client = new MemexClient();

    const wikiResp = await client.getWiki(wikiId);
    if (!wikiResp.ok) {
      console.error(`Error: ${wikiResp.error}`);
      process.exit(1);
    }

    // OAuth token mode
    if (opts.token) {
      if (!opts.token.startsWith('sk-ant-oat01-')) {
        console.error(`Error: Token must start with 'sk-ant-oat01-'.`);
        console.error(`\nGenerate one by running: claude setup-token`);
        process.exit(1);
      }

      const resp = await client.setWikiToken(wikiId, opts.token);
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      console.log(`OAuth token stored for wiki '${wikiId}'.`);
      return;
    }

    // Credentials file mode (default)
    const credsPath = opts.credentials;
    if (!existsSync(credsPath)) {
      console.error(`Error: Credentials file not found: ${credsPath}`);
      console.error(`\nOptions:`);
      console.error(`  1. Run 'claude auth login' first, then re-run this command`);
      console.error(`  2. Run 'claude setup-token' and use: memex login ${wikiId} --token <token>`);
      console.error(`  3. Set globally: memex setup-token <token>`);
      process.exit(1);
    }

    const credentials = readFileSync(credsPath, 'utf-8');

    try {
      JSON.parse(credentials);
    } catch {
      console.error(`Error: ${credsPath} is not valid JSON`);
      process.exit(1);
    }

    const resp = await client.setCredentials(wikiId, credentials);
    if (!resp.ok) {
      console.error(`Error: ${resp.error}`);
      process.exit(1);
    }

    console.log(`Credentials copied from ${credsPath} to wiki '${wikiId}'.`);
  });
