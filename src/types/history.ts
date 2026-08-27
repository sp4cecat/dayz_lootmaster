/**
 * Shapes returned by /api/history/*, recorded from the companion mod's 5 s
 * snapshot stream (see server/history-store.js).
 *
 * Sentinel handling happens server-side: a stat the engine never declared arrives
 * here as `null`, never as -1, and an empty hands slot is `null`, never "". A
 * consumer can therefore treat null as "unknown" without re-checking for -1.
 */

/** One recorded sample of one player. */
export interface HistoryPoint {
  /** Epoch ms, the backend's receive time — not the in-game clock. */
  ts: number;
  x: number;
  /** Terrain height. Carried for completeness; no view uses it for distance. */
  y: number;
  z: number;
  health: number | null;
  blood: number | null;
  shock: number | null;
  energy: number | null;
  water: number | null;
  alive: boolean | null;
  /** Classname of the item in hands; null when empty-handed or unknown. */
  hands: string | null;
  /**
   * The player was ABSENT between the previous point and this one.
   *
   * Computed server-side from the raw sampling and force-retained through
   * decimation. Consumers must use this rather than comparing timestamps: a
   * decimated track puts a long interval between two points of an uninterrupted
   * walk, so a duration test reads continuous movement as a logout.
   */
  gap: boolean;
}

/** One player's decimated path over the requested window. */
export interface HistoryTrack {
  pid: string;
  name: string | null;
  /** SQL sampling step applied before simplification; 1 means every sample. */
  stride: number;
  points: HistoryPoint[];
  /** Runs of continuous presence; more than one means the player was away and returned. */
  runs: number;
  sampled: number;
  /** True when points were dropped — the path is a shape, not every reading. */
  simplified: boolean;
}

/** A player that appears in the recorded window. */
export interface HistoryPlayer {
  pid: string;
  name: string | null;
  steamId: string | null;
  samples: number;
  firstTs: number;
  lastTs: number;
}

/**
 * One continuous presence inside a queried circle. Consecutive in-radius samples
 * collapse into a visit; a gap longer than the query's `gap` starts a new one.
 */
export interface AreaVisit {
  pid: string;
  name: string | null;
  enteredAt: number;
  leftAt: number;
  durationMs: number;
  samples: number;
  /** Closest approach to the query centre, metres (planar; elevation ignored). */
  closestM: number;
  closestAt: number;
}

/** A player's position at a requested instant. */
export interface HistoryAtPoint extends HistoryPoint {
  pid: string;
  name: string | null;
}

/** Recorder health and volume. Drives the tool's empty and unhealthy states. */
export interface HistoryStats {
  enabled: boolean;
  ready: boolean;
  dbFile: string;
  rows: number;
  players: number;
  /** Epoch ms of the oldest and newest recorded sample; null when empty. */
  from: number | null;
  to: number | null;
  bytes: number | null;
  writes: number;
  failures: number;
  lastWriteAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  recordAi: boolean;
  retention: { fullDays: number; thinDays: number };
}

/** Why the history tool has nothing to show. */
export type HistoryUnavailableReason = 'disabled' | 'error' | 'empty' | 'unreachable';

export interface HistoryEnvelope<T> {
  available: boolean;
  reason?: HistoryUnavailableReason;
  error?: string;
  items: T[];
}

/** The three things the map tool can be doing. */
export type HistoryMode = 'paths' | 'playback' | 'area';

/** A circular map selection, in world metres. */
export interface AreaSelection {
  x: number;
  z: number;
  radius: number;
}
