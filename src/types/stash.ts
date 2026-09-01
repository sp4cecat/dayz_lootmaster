/**
 * Wire types for the underground stash report (`POST /api/logs/stash-report`).
 *
 * The report answers one question: who is digging up other people's stashes?
 * Everything here exists so an accusation can be checked rather than trusted —
 * each score comes with the factors that produced it, and each factor with the
 * individual digs behind it, down to the log file and line number.
 *
 * Mirrors server/stash-report.js. See that file for the matching rules.
 */

export type StashSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Who buried the stash that was dug up. */
export type StashOwner =
  /** The digger's own stash. */
  | 'own'
  /** Someone else's, with the bury on record. */
  | 'foreign'
  /** Dug up, but no bury on record — usually the bury predates the logs. */
  | 'unknown';

/** How a player got to a stash, from the movement history. */
export interface StashApproach {
  available: boolean;
  /** Why there is nothing to say: no-samples, too-few-samples, budget, not-analysed, error. */
  reason?: string | null;
  /** Sample cadence. 'coarse' is admin-log backfill and over-reports straightness. */
  resolution?: 'coarse' | 'fine' | 'mixed';
  samples?: number;
  spanMs?: number;
  pathM?: number;
  displacementM?: number;
  /** displacement / path length. 1 is a perfect straight line. */
  straightness?: number;
  /** Direction changes on the way in. A search has many; a commute has none. */
  turns?: number;
  /** How far away the tracked approach started. */
  approachM?: number;
  /** How close the track ended to the stash. */
  finalM?: number;
  beeline?: boolean;
  priorVisits?: number | null;
  priorClosestM?: number;
  lastPriorAt?: number;
  /** Had the digger been near this spot before it was buried? */
  everBeforeBury?: boolean | null;
  /**
   * Whether "never been here" means anything. False when the player was not being
   * sampled at the time, in which case absence is a fact about the log, not them.
   */
  priorMeaningful?: boolean;
}

/** One dig-up. */
export interface StashLedgerEntry {
  i: number;
  ts: number;
  x: number;
  z: number;
  y: number;
  /** UndergroundStash or UndergroundStashSnow — what was unearthed. */
  stashClass: string;
  digger: { id: string; alias: string | null };
  owner: StashOwner;
  /** The matched bury. `cls` is the container that was buried, e.g. DryBag_Black. */
  bury: {
    ts: number;
    id: string;
    alias: string | null;
    cls: string;
    x: number;
    z: number;
    file: string;
    line: number;
  } | null;
  secondsSinceBury: number | null;
  matchDistanceM: number | null;
  approach?: StashApproach;
  historyPid?: string;
  file: string;
  line: number;
}

/** One component of a player's score, with the evidence that produced it. */
export interface StashFactor {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  points: number;
  max: number;
  detail: string | null;
}

export interface StashPlayerTrack {
  available: boolean;
  reason?: string | null;
  analysed: number;
  beelines?: number;
  strangerDigs?: number;
  familiarDigs?: number;
  resolution?: 'coarse' | 'fine' | 'mixed';
  multiplier: number;
}

export interface StashPlayer {
  id: string;
  aliases: string[];
  score: number;
  severity: StashSeverity;
  /**
   * How much of this player's digging the bury ledger could explain, 0-1.
   * Deliberately separate from the score: a short log makes everyone look
   * unattributable, and that is not the same as looking guilty.
   */
  confidence: number;
  confidenceNote: string | null;
  counts: {
    buried: number;
    buriedAllTime: number;
    dugOwn: number;
    dugForeign: number;
    dugUnknown: number;
    dugTotal: number;
  };
  victims: { id: string; alias: string | null }[];
  factors: StashFactor[];
  track: StashPlayerTrack;
  /** Indexes into `ledger`, not copies — the ledger is shared across players. */
  events: number[];
}

/** Diagnostics, so an empty report can explain itself instead of just being empty. */
export interface StashMeta {
  files: { found: number; dated: number; read: number; cached: number; failed: number };
  lines: { scanned: number; timestamped: number; stash: number; in: number; out: number };
  ledger: {
    from: number | null;
    to: number | null;
    spanDays: number;
    own: number;
    foreign: number;
    unknown: number;
    openAtEnd: number;
    stackedBuries: number;
    expiredBuries: number;
    maxBuryAgeDays: number;
  };
  coverage: {
    digsInWindow: number;
    digsOutsideWindow: number;
    windowStartsBeforeLedger: boolean;
    windowEndsAfterLedger: boolean;
  };
  match: { toleranceM: number; cellM: number; exact: number; nearby: number; unmatched: number };
  track: {
    available: boolean;
    reason?: string | null;
    rows?: number;
    bySrc?: { mod: number; adm: number } | null;
    from?: number | null;
    to?: number | null;
    guidLedger?: { ok: boolean; size: number; path: string | null };
    lookups?: number;
    hits?: number;
    misses?: number;
    budgetHit?: boolean;
    analysed?: number;
  };
  timings: { readMs: number; matchMs: number; trackMs: number; totalMs: number };
  weights: { logMax: number };
}

export interface StashReport {
  ok: boolean;
  version: number;
  window: { from: number | null; to: number | null; timeZone: string | null };
  summary: {
    buries: number;
    digs: number;
    own: number;
    foreign: number;
    unknown: number;
    players: number;
    flagged: number;
    victims: number;
    topScore: number;
  };
  players: StashPlayer[];
  ledger: StashLedgerEntry[];
  meta: StashMeta;
}

export const SEVERITY_COLOR: Record<StashSeverity, 'gray' | 'success' | 'warning' | 'orange' | 'error'> = {
  none: 'gray',
  low: 'success',
  medium: 'warning',
  high: 'orange',
  critical: 'error',
};

/** Marker/'text colour per attribution. Own is unremarkable; foreign is the finding. */
export const OWNER_COLOR: Record<StashOwner, string> = {
  own: '#22c55e',
  foreign: '#ef4444',
  unknown: '#f59e0b',
};

export const OWNER_LABEL: Record<StashOwner, string> = {
  own: 'Own stash',
  foreign: "Another player's",
  unknown: 'Unattributed',
};
