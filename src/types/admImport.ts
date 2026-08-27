/** Shapes returned by /api/logs/adm/scan and /api/logs/adm/import. */

/** How the archive's UTC offset was decided. */
export type OffsetSource = 'mtime' | 'logdir' | 'default';

export interface OffsetVote {
  /** Minutes east of UTC. 600 = +10:00. */
  offsetMinutes: number;
  source: OffsetSource;
  /** Files backing the winning answer. */
  votes: number;
  total: number;
  /** Files that disagreed using the same signal — a real conflict, worth showing. */
  disagreement: number;
}

export interface AdmScanFile {
  path: string;
  bytes: number;
  /** Epoch ms of the log's first entry under the archive-wide offset; null if undated. */
  startsAt: number | null;
  detectedOffset: number | null;
  detectedSource: OffsetSource | null;
  confident: boolean;
  /** Set when the file cannot be imported, with the reason. */
  skip: string | null;
}

export interface GuidLedgerInfo {
  ok: boolean;
  /** Number of GUID -> steam64 mappings available. */
  size: number;
  path: string;
  error: string | null;
}

export interface AdmScan {
  root: string;
  defaultRoot: string;
  offset: OffsetVote;
  ledger: GuidLedgerInfo;
  files: AdmScanFile[];
}

export interface AdmImportResult {
  files: number;
  skipped: number;
  /** Rows parsed out of the logs. */
  rows: number;
  /** Rows actually stored — lower than `rows` when an archive overlaps itself. */
  inserted: number;
  /** connect/disconnect lines used as session boundaries. */
  events: number;
  resolved: number;
  unresolved: number;
  unresolvedGuids: number;
  firstTs: number | null;
  lastTs: number | null;
  errors: { path: string; error: string }[];
}

export interface AdmImportJob {
  idle: boolean;
  running: boolean;
  startedAt?: number;
  finishedAt?: number | null;
  root?: string;
  offsetMinutes?: number;
  totalFiles?: number;
  progress?: (AdmImportResult & { current: string }) | null;
  result?: AdmImportResult | null;
  error?: string | null;
  aborted?: boolean;
}
