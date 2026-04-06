import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WIKIS_DIR } from '../lib/constants.js';
import { NoCredentialsError } from '../lib/errors.js';

export class AuthManager {
  constructor(
    private wikisDir: string = WIKIS_DIR,
    private globalApiKey?: string,
  ) {}

  /**
   * Resolve credentials for a wiki, returning environment variables
   * to set on the claude child process.
   *
   * Priority:
   *   1. Per-wiki API key file (.claude/api-key)
   *   2. Per-wiki OAuth credentials (.claude/.credentials.json exists)
   *   3. Global ANTHROPIC_API_KEY from daemon environment
   */
  resolveCredentials(wikiId: string): Record<string, string> {
    const claudeDir = this.configDir(wikiId);

    // 1. Per-wiki API key
    const apiKeyPath = join(claudeDir, 'api-key');
    if (existsSync(apiKeyPath)) {
      const key = readFileSync(apiKeyPath, 'utf-8').trim();
      if (key) {
        return {
          ANTHROPIC_API_KEY: key,
          CLAUDE_CONFIG_DIR: claudeDir,
        };
      }
    }

    // 2. Per-wiki OAuth credentials
    const credsPath = join(claudeDir, '.credentials.json');
    if (existsSync(credsPath)) {
      return {
        CLAUDE_CONFIG_DIR: claudeDir,
      };
    }

    // 3. Global API key
    if (this.globalApiKey) {
      return {
        ANTHROPIC_API_KEY: this.globalApiKey,
        CLAUDE_CONFIG_DIR: claudeDir,
      };
    }

    throw new NoCredentialsError(wikiId);
  }

  /**
   * Store an API key for a wiki.
   */
  setApiKey(wikiId: string, key: string): void {
    const claudeDir = this.configDir(wikiId);
    mkdirSync(claudeDir, { recursive: true, mode: 0o700 });
    const apiKeyPath = join(claudeDir, 'api-key');
    writeFileSync(apiKeyPath, key.trim(), { mode: 0o600 });
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
    const apiKeyPath = join(claudeDir, 'api-key');
    const credsPath = join(claudeDir, '.credentials.json');
    return existsSync(apiKeyPath) || existsSync(credsPath) || !!this.globalApiKey;
  }
}
