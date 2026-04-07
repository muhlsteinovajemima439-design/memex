import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, WIKIS_DIR } from '../lib/constants.js';
import { NoCredentialsError } from '../lib/errors.js';

/** File where the global OAuth token is persisted (mode 0600). */
const GLOBAL_TOKEN_PATH = join(DATA_DIR, '.oauth-token');

export class AuthManager {
  private globalOAuthToken?: string;

  constructor(
    private wikisDir: string = WIKIS_DIR,
  ) {
    // Load persisted global token on startup
    this.globalOAuthToken = this.loadGlobalToken();
  }

  /**
   * Resolve credentials for a wiki, returning environment variables
   * to set on the claude child process.
   *
   * Priority:
   *   1. Per-wiki OAuth token file (.claude/oauth-token)
   *   2. Per-wiki OAuth credentials (.claude/.credentials.json exists)
   *   3. Global OAuth token (from `memex setup-token`)
   */
  resolveCredentials(wikiId: string): Record<string, string> {
    const claudeDir = this.configDir(wikiId);

    // 1. Per-wiki OAuth token
    const tokenPath = join(claudeDir, 'oauth-token');
    if (existsSync(tokenPath)) {
      const token = readFileSync(tokenPath, 'utf-8').trim();
      if (token) {
        return {
          CLAUDE_CODE_OAUTH_TOKEN: token,
          CLAUDE_CONFIG_DIR: claudeDir,
        };
      }
    }

    // 2. Per-wiki OAuth credentials (.credentials.json from `claude auth login`)
    const credsPath = join(claudeDir, '.credentials.json');
    if (existsSync(credsPath)) {
      return {
        CLAUDE_CONFIG_DIR: claudeDir,
      };
    }

    // 3. Global OAuth token
    if (this.globalOAuthToken) {
      return {
        CLAUDE_CODE_OAUTH_TOKEN: this.globalOAuthToken,
        CLAUDE_CONFIG_DIR: claudeDir,
      };
    }

    throw new NoCredentialsError(wikiId);
  }

  /**
   * Store and activate a global OAuth token (from `claude setup-token`).
   * This is the daemon-wide fallback used when a wiki has no per-wiki credentials.
   */
  setGlobalToken(token: string): void {
    const trimmed = token.trim();
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(GLOBAL_TOKEN_PATH, trimmed, { mode: 0o600 });
    this.globalOAuthToken = trimmed;
  }

  /**
   * Check if a global OAuth token is configured.
   */
  hasGlobalToken(): boolean {
    return !!this.globalOAuthToken;
  }

  /**
   * Store an OAuth token for a specific wiki.
   */
  setWikiToken(wikiId: string, token: string): void {
    const claudeDir = this.configDir(wikiId);
    mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
    const tokenPath = join(claudeDir, 'oauth-token');
    writeFileSync(tokenPath, token.trim(), { mode: 0o600 });
  }

  /**
   * Get the CLAUDE_CONFIG_DIR path for a wiki.
   */
  configDir(wikiId: string): string {
    return join(this.wikisDir, wikiId, '.claude');
  }

  /**
   * Store OAuth credentials for a wiki by copying .credentials.json content.
   */
  setCredentials(wikiId: string, credentialsJson: string): void {
    const claudeDir = this.configDir(wikiId);
    mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
    const credsPath = join(claudeDir, '.credentials.json');
    writeFileSync(credsPath, credentialsJson, { mode: 0o600 });
  }

  /**
   * Check if a wiki has valid credentials (any method).
   */
  hasCredentials(wikiId: string): boolean {
    const claudeDir = this.configDir(wikiId);
    const tokenPath = join(claudeDir, 'oauth-token');
    const credsPath = join(claudeDir, '.credentials.json');
    return existsSync(tokenPath) || existsSync(credsPath) || !!this.globalOAuthToken;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private loadGlobalToken(): string | undefined {
    if (existsSync(GLOBAL_TOKEN_PATH)) {
      const token = readFileSync(GLOBAL_TOKEN_PATH, 'utf-8').trim();
      if (token) return token;
    }
    return undefined;
  }
}
