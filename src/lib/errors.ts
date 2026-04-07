export class MemexError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'MemexError';
  }
}

export class WikiNotFoundError extends MemexError {
  constructor(wikiId: string) {
    super(`Wiki '${wikiId}' not found`, 'WIKI_NOT_FOUND', 404);
  }
}

export class WikiExistsError extends MemexError {
  constructor(wikiId: string) {
    super(`Wiki '${wikiId}' already exists`, 'WIKI_EXISTS', 409);
  }
}

export class JobNotFoundError extends MemexError {
  constructor(jobId: number) {
    super(`Job #${jobId} not found`, 'JOB_NOT_FOUND', 404);
  }
}

export class NamespaceError extends MemexError {
  constructor(message: string) {
    super(message, 'NAMESPACE_ERROR', 500);
  }
}

export class CapabilityError extends MemexError {
  constructor() {
    super(
      'CAP_SYS_ADMIN is required for mount namespace isolation.\n' +
      'Options:\n' +
      '  1. Run the daemon as root: sudo memex serve\n' +
      '  2. Use systemd with AmbientCapabilities=CAP_SYS_ADMIN\n' +
      '  3. Grant capability: sudo setcap cap_sys_admin+ep $(which node)',
      'NO_CAP_SYS_ADMIN',
      500
    );
  }
}

export class NoCredentialsError extends MemexError {
  constructor(wikiId: string) {
    super(
      `No credentials configured for wiki '${wikiId}'.\n` +
      'Set credentials with:\n' +
      `  memex setup-token <token>               (global, all wikis)\n` +
      `  memex login ${wikiId} --token <token>    (per-wiki)\n` +
      `  memex login ${wikiId}                    (copy ~/.claude credentials)\n` +
      '\nGenerate a token by running: claude setup-token',
      'NO_CREDENTIALS',
      400
    );
  }
}

export class ForbiddenError extends MemexError {
  constructor(wikiId: string) {
    super(`Access denied to wiki '${wikiId}'`, 'FORBIDDEN', 403);
  }
}

export class ValidationError extends MemexError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class DaemonNotRunningError extends MemexError {
  constructor() {
    super(
      'Cannot connect to memex daemon.\n' +
      'Start it with: memex serve',
      'DAEMON_NOT_RUNNING',
      502
    );
  }
}
