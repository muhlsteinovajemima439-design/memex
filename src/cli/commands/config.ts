import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { MemexClient } from '../client.js';
import { WIKIS_DIR, ALLOWED_TOOLS_WHITELIST, BASE_ALLOWED_TOOLS } from '../../lib/constants.js';
import { join } from 'node:path';

export const configCommand = new Command('config')
  .description('Configure a wiki')
  .argument('<wikiId>', 'Wiki to configure')
  .option('--edit', 'Open .claude.md in $EDITOR')
  .option('--set-key', 'Set the API key for this wiki')
  .option('--model <model>', 'Set the default model (e.g., sonnet, opus, haiku)')
  .option('--allowed-tools <tools>', 'Set allowed tools (comma-separated, e.g., WebSearch,WebFetch)')
  .option('--list-tools', 'Show available tools and current configuration')
  .action(async (wikiId: string, opts: { edit?: boolean; setKey?: boolean; model?: string; allowedTools?: string; listTools?: boolean }) => {
    const client = new MemexClient();

    // Verify wiki exists
    const wikiResp = await client.getWiki(wikiId);
    if (!wikiResp.ok) {
      console.error(`Error: ${wikiResp.error}`);
      process.exit(1);
    }

    if (opts.edit) {
      const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
      const claudeMdPath = join(WIKIS_DIR, wikiId, '.claude.md');
      try {
        execFileSync(editor, [claudeMdPath], { stdio: 'inherit' });
        console.log(`Updated .claude.md for '${wikiId}'`);
      } catch {
        console.error(`Failed to open editor. Set $EDITOR environment variable.`);
        process.exit(1);
      }
      return;
    }

    if (opts.setKey) {
      const key = await promptSecret('API key: ');
      const resp = await client.setApiKey(wikiId, key);
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      console.log(`API key set for '${wikiId}'`);
      return;
    }

    if (opts.listTools) {
      const extras = [...ALLOWED_TOOLS_WHITELIST].filter(t => !BASE_ALLOWED_TOOLS.includes(t));
      console.log(`Base tools (always enabled): ${BASE_ALLOWED_TOOLS.join(', ')}`);
      console.log(`Available extras: ${extras.join(', ')}`);
      console.log(`\nTo enable extras: memex config ${wikiId} --allowed-tools ${extras.join(',')}`);
      return;
    }

    if (opts.allowedTools !== undefined) {
      const tools = opts.allowedTools
        ? opts.allowedTools.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      const resp = await client.updateConfig(wikiId, { allowed_tools: tools });
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      if (tools.length === 0) {
        console.log(`Allowed tools reset to base set for '${wikiId}'`);
      } else {
        console.log(`Allowed tools set for '${wikiId}': ${tools.join(', ')}`);
      }
      return;
    }

    if (opts.model) {
      const resp = await client.updateConfig(wikiId, { default_model: opts.model });
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }
      console.log(`Model set to '${opts.model}' for '${wikiId}'`);
      return;
    }

    // No option specified — show current config
    const wiki = wikiResp.data!;
    console.log(`Wiki: ${wiki.id}`);
    console.log(`Name: ${wiki.name}`);
    console.log(`Model: ${wiki.default_model}`);
    console.log(`Created: ${wiki.created_at}`);
    console.log(`\nConfig file: ${join(WIKIS_DIR, wikiId, '.claude.md')}`);
  });

function promptSecret(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    // Disable echo for secret input
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      let input = '';
      const onData = (chunk: Buffer) => {
        const char = chunk.toString('utf-8');
        if (char === '\n' || char === '\r') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (char === '\x7f' || char === '\x08') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
        } else if (char === '\x03') {
          // Ctrl+C
          rl.close();
          process.exit(0);
        } else {
          input += char;
        }
      };
      stdin.on('data', onData);
    } else {
      // Non-TTY (piped input)
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}
