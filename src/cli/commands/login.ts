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
  .option('--api-key <key>', 'Use an API key instead of OAuth credentials')
  .action(async (wikiId: string, opts: { credentials: string; apiKey?: string }) => {
    const client = new MemexClient();

    const wikiResp = await client.getWiki(wikiId);
    if (!wikiResp.ok) {
      console.error(`Error: ${wikiResp.error}`);
      process.exit(1);
    }

    // API key mode
    if (opts.apiKey) {
      const resp = await client.setApiKey(wikiId, opts.apiKey);
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      console.log(`API key stored for wiki '${wikiId}'.`);
      return;
    }

    // Credentials file mode (default)
    const credsPath = opts.credentials;
    if (!existsSync(credsPath)) {
      console.error(`Error: Credentials file not found: ${credsPath}`);
      console.error(`\nRun 'claude auth login' first, or pass --credentials <path>`);
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
