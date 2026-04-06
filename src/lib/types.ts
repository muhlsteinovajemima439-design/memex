// ── Wiki ─────────────────────────────────────────────────────────────────────

export interface Wiki {
  id: string;
  name: string;
  owner_uid: number;
  default_model: string;
  created_at: string;
}

export interface WikiConfig {
  name?: string;
  default_model?: string;
  allowed_tools?: string[];
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export type JobType = 'ingest' | 'query' | 'lint';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface QueueJob {
  id: number;
  wiki_id: string;
  type: JobType;
  payload: string;        // JSON-encoded
  status: JobStatus;
  retry_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;  // JSON-encoded JobResult or error string
}

export interface IngestPayload {
  files: string[];         // filenames relative to wiki/raw/
}

export interface QueryPayload {
  question: string;
  history?: string[];      // optional prior conversation turns
}

export interface LintPayload {
  // empty for v1
}

export interface JobResult {
  success: boolean;
  output: string;
  exit_code: number;
  duration_ms: number;
}

// ── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  wiki_id: string;
  action: string;
  detail: string | null;
  created_at: string;
}

// ── API ──────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface CreateWikiRequest {
  id: string;
  name?: string;
}

export interface SubmitJobRequest {
  type: JobType;
  payload: IngestPayload | QueryPayload | LintPayload;
  wait?: boolean;
}

export interface RouteResponse {
  status: number;
  body: ApiResponse;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface JobLimits {
  timeout_ms: number;
  max_turns: number;
}

export interface DaemonConfig {
  socketPath: string;
  dataDir: string;
  runDir: string;
  autoLintInterval: number;
}
