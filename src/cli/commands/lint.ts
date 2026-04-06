import { Command } from 'commander';
import { MemexClient } from '../client.js';

export const lintCommand = new Command('lint')
  .description('Run a maintenance health check on a wiki')
  .argument('<wikiId>', 'Target wiki')
  .option('--async', 'Return job ID immediately instead of waiting')
  .action(async (wikiId: string, opts: { async?: boolean }) => {
    const client = new MemexClient();

    const jobResp = await client.submitJob(wikiId, 'lint', {});
    if (!jobResp.ok) {
      console.error(`Error: ${jobResp.error}`);
      process.exit(1);
    }

    const job = jobResp.data!;

    if (opts.async) {
      console.log(`Lint job #${job.id} submitted`);
      console.log(`Check status: memex status ${wikiId} ${job.id}`);
      return;
    }

    process.stdout.write('Checking wiki health');
    const result = await client.waitForJob(wikiId, job.id, () => {
      process.stdout.write('.');
    });
    console.log('\n');

    if (result.status === 'completed') {
      const parsed = safeParseResult(result.result);
      console.log(parsed?.output ?? result.result ?? '(no output)');
    } else {
      console.error('Lint failed.');
      const parsed = safeParseResult(result.result);
      console.error(parsed?.error ?? parsed?.output ?? result.result);
      process.exit(1);
    }
  });

function safeParseResult(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { output: raw };
  }
}
