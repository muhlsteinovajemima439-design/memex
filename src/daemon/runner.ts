import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NamespaceManager } from './namespace.js';
import type { AuthManager } from './auth.js';
import type { Database } from './db.js';
import type { QueueJob, JobResult, IngestPayload, QueryPayload } from '../lib/types.js';
import {
  JOB_LIMITS, SIGTERM_GRACE_MS, BASE_ALLOWED_TOOLS, ALLOWED_TOOLS_WHITELIST, DEFAULT_MODEL, WORKSPACE_MOUNT,
} from '../lib/constants.js';
import { buildIngestPrompt } from '../lib/prompts/ingest.js';
import { buildQueryPrompt } from '../lib/prompts/query.js';
import { buildLintPrompt } from '../lib/prompts/lint.js';
import { getWikiSystemPrompt } from '../lib/prompts/wiki.js';

export class ClaudeRunner {
  private active = new Map<number, ChildProcess>();

  constructor(
    private namespace: NamespaceManager,
    private auth: AuthManager,
    private db: Database,
    private wikisDir: string,
  ) {}

  async run(job: QueueJob): Promise<JobResult> {
    const startTime = Date.now();
    const wikiId = job.wiki_id;
    const wiki = this.db.getWiki(wikiId);
    const model = wiki?.default_model ?? DEFAULT_MODEL;
    const limits = JOB_LIMITS[job.type as keyof typeof JOB_LIMITS];

    // Build the task prompt
    const prompt = this.buildPrompt(job);

    // Resolve credentials
    const credEnv = this.auth.resolveCredentials(wikiId);

    // Resolve allowed tools
    const tools = this.resolveTools(wikiId);

    // Build claude -p command args
    const claudeArgs = this.buildClaudeArgs(prompt, model, limits.max_turns, tools, wikiId);

    // Wrap in a per-job mount namespace
    const wrapped = this.namespace.wrapCommand(wikiId, claudeArgs);

    // Build environment
    const env: Record<string, string> = {
      ...filterEnv(process.env),
      ...credEnv,
      HOME: WORKSPACE_MOUNT,
    };

    // If CLAUDE_CONFIG_DIR was set by auth, remap it to namespace path
    if (credEnv['CLAUDE_CONFIG_DIR']) {
      env['CLAUDE_CONFIG_DIR'] = `${WORKSPACE_MOUNT}/.claude`;
    }

    return new Promise<JobResult>((resolve) => {
      const child = spawn(wrapped.command, wrapped.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin immediately — prompt is passed via -p flag, not stdin
      child.stdin!.end();

      this.active.set(job.id, child);

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk));

      // Timeout management: SIGTERM → grace period → SIGKILL
      const timeout = setTimeout(() => {
        console.warn(`[runner] Job #${job.id} timed out after ${limits.timeout_ms}ms, sending SIGTERM`);
        child.kill('SIGTERM');

        setTimeout(() => {
          if (!child.killed) {
            console.warn(`[runner] Job #${job.id} did not exit after SIGTERM grace period, sending SIGKILL`);
            child.kill('SIGKILL');
          }
        }, SIGTERM_GRACE_MS);
      }, limits.timeout_ms);

      child.on('close', (code) => {
        clearTimeout(timeout);
        this.active.delete(job.id);

        const duration_ms = Date.now() - startTime;
        const rawOut = Buffer.concat(stdout).toString('utf-8');
        const rawErr = Buffer.concat(stderr).toString('utf-8');

        // Parse JSON output from claude --output-format json
        // Claude wraps output in { result: "...", ... }
        let output = rawOut;
        try {
          const envelope = JSON.parse(rawOut);
          const text = envelope.result ?? '';
          // Try to parse the result text as structured JSON from the prompt
          try {
            output = JSON.stringify(JSON.parse(text));
          } catch {
            output = text.trim() || rawOut;
          }
        } catch {
          // Claude output wasn't JSON — use raw stdout
        }

        if (rawErr) {
          console.error(`[runner] Job #${job.id} stderr: ${rawErr.slice(0, 500)}`);
        }

        // On failure, include stderr in output so the error is visible
        const finalOutput = code === 0
          ? output
          : [output, rawErr].filter(Boolean).join('\n').trim() || `claude exited with code ${code}`;

        resolve({
          success: code === 0,
          output: finalOutput,
          exit_code: code ?? 1,
          duration_ms,
        });
      });
    });
  }

  /**
   * Kill an active job's process. Used during graceful shutdown.
   */
  kill(jobId: number): void {
    const child = this.active.get(jobId);
    if (child) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, SIGTERM_GRACE_MS);
    }
  }

  /**
   * Kill all active processes. Used during daemon shutdown.
   */
  killAll(): void {
    for (const [jobId] of this.active) {
      this.kill(jobId);
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private buildPrompt(job: QueueJob): string {
    const payload = JSON.parse(job.payload);

    switch (job.type) {
      case 'ingest':
        return buildIngestPrompt(payload as IngestPayload);
      case 'query':
        return buildQueryPrompt(payload as QueryPayload);
      case 'lint':
        return buildLintPrompt();
      default:
        return `Unknown job type: ${job.type}`;
    }
  }

  private resolveTools(wikiId: string): string[] {
    const tools = [...BASE_ALLOWED_TOOLS];

    const allowedPath = join(this.wikisDir, wikiId, '.tools', 'allowed-tools.txt');
    if (existsSync(allowedPath)) {
      const extra = readFileSync(allowedPath, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && ALLOWED_TOOLS_WHITELIST.has(l));
      tools.push(...extra);
    }

    return [...new Set(tools)]; // dedupe
  }

  private buildClaudeArgs(
    prompt: string,
    model: string,
    maxTurns: number,
    tools: string[],
    wikiId: string,
  ): string[] {
    const toolStr = tools.join(',');
    const args = [
      'claude',
      '-p', prompt,
      '--model', model,
      '--max-turns', String(maxTurns),
      '--output-format', 'json',
      '--tools', toolStr,            // restrict which tools EXIST (hard boundary)
      '--allowedTools', toolStr,     // pre-approve those tools (no interactive prompts)
    ];

    // Append wiki system prompt
    const systemPrompt = getWikiSystemPrompt();
    args.push('--append-system-prompt', systemPrompt);

    // MCP config (if the wiki has one)
    const mcpPath = join(this.wikisDir, wikiId, '.tools', 'mcp.json');
    if (existsSync(mcpPath)) {
      // Inside the namespace, this will be at /workspace/.tools/mcp.json
      args.push('--mcp-config', `${WORKSPACE_MOUNT}/.tools/mcp.json`);
    }

    return args;
  }
}

/**
 * Filter process.env to only include safe environment variables.
 * Exclude anything that could leak host info or interfere with Claude.
 */
function filterEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const safe: Record<string, string> = {};
  const keep = ['PATH', 'LANG', 'LC_ALL', 'TERM', 'NODE_ENV'];
  for (const key of keep) {
    if (env[key]) safe[key] = env[key];
  }
  return safe;
}
