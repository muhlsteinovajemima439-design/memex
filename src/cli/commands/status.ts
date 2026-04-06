import { Command } from 'commander';
import { MemexClient } from '../client.js';
import type { QueueJob } from '../../lib/types.js';

export const statusCommand = new Command('status')
  .description('Check job status for a wiki')
  .argument('<wikiId>', 'Target wiki')
  .argument('[jobId]', 'Specific job ID (omit to list recent jobs)')
  .action(async (wikiId: string, jobId?: string) => {
    const client = new MemexClient();

    if (jobId) {
      // Show single job
      const resp = await client.getJob(wikiId, parseInt(jobId, 10));
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }

      const job = resp.data as QueueJob;
      console.log(`Job #${job.id}`);
      console.log(`  Type:      ${job.type}`);
      console.log(`  Status:    ${job.status}`);
      console.log(`  Created:   ${job.created_at}`);
      if (job.started_at) console.log(`  Started:   ${job.started_at}`);
      if (job.completed_at) console.log(`  Completed: ${job.completed_at}`);

      if (job.result) {
        try {
          const parsed = JSON.parse(job.result);
          if (parsed.output) {
            console.log(`\nOutput:\n${parsed.output}`);
          }
          if (parsed.error) {
            console.log(`\nError:\n${parsed.error}`);
          }
          if (parsed.duration_ms) {
            console.log(`\nDuration: ${parsed.duration_ms}ms`);
          }
        } catch {
          console.log(`\nResult: ${job.result}`);
        }
      }
    } else {
      // List recent jobs
      const resp = await client.listJobs(wikiId);
      if (!resp.ok) {
        console.error(`Error: ${resp.error}`);
        process.exit(1);
      }

      const jobs = (resp.data ?? []) as QueueJob[];
      if (jobs.length === 0) {
        console.log(`No jobs for wiki '${wikiId}'.`);
        return;
      }

      const header = padRow('ID', 'TYPE', 'STATUS', 'CREATED');
      console.log(header);
      console.log('-'.repeat(header.length));

      for (const job of jobs) {
        console.log(padRow(
          String(job.id),
          job.type,
          job.status,
          job.created_at,
        ));
      }
    }
  });

function padRow(id: string, type: string, status: string, created: string): string {
  return `${id.padEnd(8)} ${type.padEnd(10)} ${status.padEnd(12)} ${created}`;
}
