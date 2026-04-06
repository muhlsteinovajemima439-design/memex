import BetterSqlite3 from 'better-sqlite3';
import type {
  Wiki, WikiConfig, QueueJob, JobType, JobStatus, JobResult, AuditEntry,
} from '../lib/types.js';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  // ── Schema ───────────────────────────────────────────────────────────────

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wikis (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_uid INTEGER NOT NULL,
        default_model TEXT NOT NULL DEFAULT 'sonnet',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS queue_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wiki_id TEXT NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        result TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wiki_id TEXT NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_queue_wiki_status
        ON queue_jobs(wiki_id, status);
      CREATE INDEX IF NOT EXISTS idx_audit_wiki
        ON audit_log(wiki_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created
        ON audit_log(created_at);
    `);

  }

  close(): void {
    this.db.close();
  }

  // ── Wikis ───────────────────────────────────────────────────────────────

  createWiki(id: string, name: string, ownerUid: number): Wiki {
    const stmt = this.db.prepare(`
      INSERT INTO wikis (id, name, owner_uid) VALUES (?, ?, ?)
      RETURNING *
    `);
    return stmt.get(id, name, ownerUid) as Wiki;
  }

  getWiki(id: string): Wiki | undefined {
    return this.db.prepare('SELECT * FROM wikis WHERE id = ?').get(id) as Wiki | undefined;
  }

  listWikis(ownerUid?: number): Wiki[] {
    if (ownerUid !== undefined) {
      return this.db.prepare('SELECT * FROM wikis WHERE owner_uid = ? ORDER BY created_at').all(ownerUid) as Wiki[];
    }
    return this.db.prepare('SELECT * FROM wikis ORDER BY created_at').all() as Wiki[];
  }

  chownWiki(id: string, newOwnerUid: number): Wiki {
    const stmt = this.db.prepare(
      'UPDATE wikis SET owner_uid = ? WHERE id = ? RETURNING *'
    );
    return stmt.get(newOwnerUid, id) as Wiki;
  }

  updateWiki(id: string, config: WikiConfig): Wiki {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (config.name !== undefined) {
      sets.push('name = ?');
      values.push(config.name);
    }
    if (config.default_model !== undefined) {
      sets.push('default_model = ?');
      values.push(config.default_model);
    }

    if (sets.length === 0) {
      return this.getWiki(id) as Wiki;
    }

    values.push(id);
    const stmt = this.db.prepare(
      `UPDATE wikis SET ${sets.join(', ')} WHERE id = ? RETURNING *`
    );
    return stmt.get(...values) as Wiki;
  }

  deleteWiki(id: string): void {
    this.db.prepare('DELETE FROM wikis WHERE id = ?').run(id);
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  createJob(wikiId: string, type: JobType, payload: object): QueueJob {
    const stmt = this.db.prepare(`
      INSERT INTO queue_jobs (wiki_id, type, payload)
      VALUES (?, ?, ?)
      RETURNING *
    `);
    return stmt.get(wikiId, type, JSON.stringify(payload)) as QueueJob;
  }

  getJob(jobId: number): QueueJob | undefined {
    return this.db.prepare('SELECT * FROM queue_jobs WHERE id = ?').get(jobId) as QueueJob | undefined;
  }

  listJobs(wikiId: string, opts?: { status?: JobStatus; limit?: number }): QueueJob[] {
    let sql = 'SELECT * FROM queue_jobs WHERE wiki_id = ?';
    const params: unknown[] = [wikiId];

    if (opts?.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }

    sql += ' ORDER BY id DESC';

    if (opts?.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    return this.db.prepare(sql).all(...params) as QueueJob[];
  }

  /**
   * Atomically claim the next pending job for a wiki.
   * Sets status to 'running' and records started_at.
   */
  claimNextJob(wikiId: string): QueueJob | undefined {
    const stmt = this.db.prepare(`
      UPDATE queue_jobs
      SET status = 'running', started_at = datetime('now')
      WHERE id = (
        SELECT id FROM queue_jobs
        WHERE wiki_id = ? AND status = 'pending'
        ORDER BY id ASC
        LIMIT 1
      )
      RETURNING *
    `);
    return stmt.get(wikiId) as QueueJob | undefined;
  }

  completeJob(jobId: number, result: JobResult): void {
    this.db.prepare(`
      UPDATE queue_jobs
      SET status = 'completed', completed_at = datetime('now'), result = ?
      WHERE id = ?
    `).run(JSON.stringify(result), jobId);
  }

  failJob(jobId: number, error: string): void {
    this.db.prepare(`
      UPDATE queue_jobs
      SET status = 'failed', completed_at = datetime('now'), result = ?
      WHERE id = ?
    `).run(JSON.stringify({ success: false, error }), jobId);
  }

  getPendingJobCount(wikiId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM queue_jobs WHERE wiki_id = ? AND status IN ('pending', 'running')"
    ).get(wikiId) as { count: number };
    return row.count;
  }

  /**
   * On daemon startup: reset jobs that were 'running' when the process died.
   * They get re-queued as 'pending'.
   */
  resetStaleJobs(): number {
    const info = this.db.prepare(`
      UPDATE queue_jobs
      SET status = 'pending', retry_count = retry_count + 1
      WHERE status = 'running'
    `).run();
    return info.changes;
  }

  /** Get wiki IDs that have pending jobs (for startup drain). */
  wikisWithPendingJobs(): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT wiki_id FROM queue_jobs WHERE status = 'pending'"
    ).all() as { wiki_id: string }[];
    return rows.map(r => r.wiki_id);
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  logAudit(wikiId: string, action: string, detail?: string): void {
    this.db.prepare(
      'INSERT INTO audit_log (wiki_id, action, detail) VALUES (?, ?, ?)'
    ).run(wikiId, action, detail ?? null);
  }

  getAuditLog(wikiId: string, limit: number = 50): AuditEntry[] {
    return this.db.prepare(
      'SELECT * FROM audit_log WHERE wiki_id = ? ORDER BY id DESC LIMIT ?'
    ).all(wikiId, limit) as AuditEntry[];
  }
}
