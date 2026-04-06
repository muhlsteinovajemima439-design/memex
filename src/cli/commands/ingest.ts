import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { MemexClient } from '../client.js';

export const ingestCommand = new Command('ingest')
  .description('Ingest source files into a wiki')
  .argument('<wikiId>', 'Target wiki')
  .argument('<files...>', 'Files to ingest (pdf, md, html, txt, images, etc.)')
  .option('--async', 'Return job ID immediately instead of waiting')
  .action(async (wikiId: string, files: string[], opts: { async?: boolean }) => {
    const client = new MemexClient();

    // Validate files exist locally
    for (const file of files) {
      if (!existsSync(file)) {
        console.error(`File not found: ${file}`);
        process.exit(1);
      }
    }

    // Upload each file to the daemon
    const storedFiles: string[] = [];
    for (const file of files) {
      process.stdout.write(`Uploading ${file}...`);
      const resp = await client.uploadFile(wikiId, file);
      if (!resp.ok) {
        console.error(` failed: ${resp.error}`);
        process.exit(1);
      }
      storedFiles.push(resp.data!.filename);
      console.log(` done (${resp.data!.filename})`);
    }

    // Submit ingest job
    const jobResp = await client.submitJob(wikiId, 'ingest', { files: storedFiles });
    if (!jobResp.ok) {
      console.error(`Error: ${jobResp.error}`);
      process.exit(1);
    }

    const job = jobResp.data!;
    console.log(`\nIngest job #${job.id} submitted`);

    if (opts.async) {
      console.log(`Check status: memex status ${wikiId} ${job.id}`);
      return;
    }

    // Wait for completion
    process.stdout.write('Processing');
    const result = await client.waitForJob(wikiId, job.id, () => {
      process.stdout.write('.');
    });
    console.log();

    if (result.status === 'completed') {
      const parsed = safeParseResult(result.result);
      console.log('\nIngest complete.');
      if (parsed?.output) {
        console.log(parsed.output);
      }
    } else {
      console.error('\nIngest failed.');
      const parsed = safeParseResult(result.result);
      if (parsed) {
        console.error(parsed.error ?? parsed.output ?? result.result);
      }
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
