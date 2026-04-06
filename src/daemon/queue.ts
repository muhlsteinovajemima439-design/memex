import type { Database } from './db.js';
import type { ClaudeRunner } from './runner.js';
import { AUTO_LINT_INTERVAL } from '../lib/constants.js';

interface WikiState {
  active: boolean;       // is a drain loop running for this wiki?
  pending: boolean;      // has new work arrived while drain loop was active?
  ingestCount: number;   // ingests since last auto-lint
}

export class QueueManager {
  private wikis = new Map<string, WikiState>();
  private shuttingDown = false;

  constructor(
    private db: Database,
    private runner: ClaudeRunner,
    private autoLintInterval: number = AUTO_LINT_INTERVAL,
  ) {}

  /**
   * Start draining queues. Called on daemon startup.
   * Kicks off drain loops for all wikis with pending jobs.
   */
  start(): void {
    const wikisWithWork = this.db.wikisWithPendingJobs();
    for (const wikiId of wikisWithWork) {
      this.notify(wikiId);
    }
    console.log(`[queue] Started. ${wikisWithWork.length} wiki(s) have pending work.`);
  }

  /**
   * Signal that a wiki has new work to process.
   * If the wiki isn't already draining, starts a drain loop.
   */
  notify(wikiId: string): void {
    if (this.shuttingDown) return;

    let state = this.wikis.get(wikiId);
    if (!state) {
      state = { active: false, pending: false, ingestCount: 0 };
      this.wikis.set(wikiId, state);
    }

    if (state.active) {
      // Drain loop already running — just flag that new work exists
      state.pending = true;
    } else {
      // No active drain loop — start one
      this.drainWiki(wikiId, state);
    }
  }

  /**
   * Graceful shutdown. Waits for active jobs to finish.
   */
  async stop(): Promise<void> {
    this.shuttingDown = true;
    console.log('[queue] Shutting down...');

    // Wait for all active drain loops to complete their current job
    const maxWait = 30_000;
    const start = Date.now();

    while (this.runner.activeCount > 0 && Date.now() - start < maxWait) {
      await sleep(500);
    }

    if (this.runner.activeCount > 0) {
      console.warn(`[queue] ${this.runner.activeCount} job(s) still active after ${maxWait}ms, killing`);
      this.runner.killAll();
    }

    console.log('[queue] Shutdown complete.');
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async drainWiki(wikiId: string, state: WikiState): Promise<void> {
    state.active = true;
    state.pending = false;

    try {
      while (!this.shuttingDown) {
        const job = this.db.claimNextJob(wikiId);
        if (!job) break; // no more pending jobs

        console.log(`[queue] Running job #${job.id} (${job.type}) for wiki '${wikiId}'`);

        try {
          const result = await this.runner.run(job);

          if (result.success) {
            this.db.completeJob(job.id, result);
            this.db.logAudit(wikiId, `job.${job.type}.completed`, `job #${job.id} (${result.duration_ms}ms)`);
            console.log(`[queue] Job #${job.id} completed in ${result.duration_ms}ms`);
          } else {
            this.db.failJob(job.id, result.output);
            this.db.logAudit(wikiId, `job.${job.type}.failed`, `job #${job.id}: ${result.output.slice(0, 200)}`);
            console.error(`[queue] Job #${job.id} failed (exit ${result.exit_code})`);
          }

          // Auto-lint tracking
          if (job.type === 'ingest' && result.success) {
            state.ingestCount++;
            if (this.autoLintInterval > 0 && state.ingestCount >= this.autoLintInterval) {
              state.ingestCount = 0;
              this.scheduleAutoLint(wikiId);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.db.failJob(job.id, msg);
          this.db.logAudit(wikiId, `job.${job.type}.error`, `job #${job.id}: ${msg}`);
          console.error(`[queue] Job #${job.id} error: ${msg}`);
        }
      }
    } finally {
      state.active = false;

      // If new work arrived while we were draining, restart
      if (state.pending && !this.shuttingDown) {
        this.drainWiki(wikiId, state);
      }
    }
  }

  private scheduleAutoLint(wikiId: string): void {
    // Check if there's already a pending lint job to avoid stacking
    const pendingLints = this.db.listJobs(wikiId, { status: 'pending' })
      .filter(j => j.type === 'lint');

    if (pendingLints.length > 0) {
      console.log(`[queue] Skipping auto-lint for '${wikiId}' — lint already pending`);
      return;
    }

    console.log(`[queue] Scheduling auto-lint for '${wikiId}' after ${this.autoLintInterval} ingests`);
    this.db.createJob(wikiId, 'lint', {});
    // No need to notify — we're already in the drain loop and will pick it up
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
