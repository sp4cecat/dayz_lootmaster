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
  /** Row counts by provenance: the mod's live stream vs imported admin logs. */
  bySrc?: { mod: number; adm: number };
  writes: number;
  failures: number;
  lastWriteAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  recordAi: boolean;
  retention: { fullDays: number; thinDays: number };
  /**
   * Action-log and inventory volume, reported separately from `rows` rather than
   * folded into it. An empty action log usually means the running mod predates the
   * event hooks, which is a completely different situation from a quiet server —
   * and "4 million records" would hide it.
   */
  actions?: number;
  inventories?: number;
  /** Live (uncleared) player flags across every detector. */
  flags?: number;
  /** The loot-cycle detector's health, so the UI can say whether it is alive. */
  lootCycle?: LootCycleDetectorStats;
}

/**
 * One thing a player did, from the mod's event hooks.
 *
 * The mod classifies these from the engine's single inventory-transition funnel,
 * so a `drop` means the item genuinely left the player's hierarchy for the ground
 * — not that it was moved between two pockets.
 */
export interface HistoryAction {
  id: number;
  /** Epoch ms. The mod reports an age and the backend anchors it to its own clock. */
  ts: number;
  /** Actor; null for events nobody can be attributed (a CE-cleaned tent). */
  pid: string | null;
  name: string | null;
  kind: string;
  /** Item classname; null when the event is not about an item. */
  cls: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  /**
   * Free-form: `killer=<id>` or `cause=<class>` on a death, the container class on
   * a stash, JSON on a rollback. The combat kinds (`hit`, `kill`, `damaged`) carry
   * a `key=value;` list with a stable key set — `victim=<type>[:<pid>];zone=;dmg=;
   * ammo=;with=;dist=;at=` for the attacker's rows, `by=<source>;zone=;dmg=;ammo=;
   * with=[;lethal=1][;src=]` for the victim's — see `utils/actionDetail.ts`.
   */
  detail: string | null;
  /** Mod item identity (spacecat_dayz_server_api 1.4+); null on older builds. */
  iid: number | null;
  /** True when the item was CE-spawned this run and this is its first pickup; null = unknown. */
  fresh: boolean | null;
  /** Milliseconds the item sat in the player's hierarchy before a drop/stash; null = unknown. */
  held: number | null;
  /** Events the mod dropped before this batch, carried on the batch's first row; null = none reported. */
  dropped: number | null;
}

/** How many of each kind are present in a window; drives the filter chips. */
export interface ActionKindCount {
  kind: string;
  count: number;
}

/** One item in a captured loadout. Meaningful only as part of its tree. */
export interface InventoryNode {
  cls: string;
  /** Attachment slot name; null when in cargo or hands. */
  slot: string | null;
  where: 'attachment' | 'cargo' | 'hands';
  health01: number | null;
  healthLevel: number | null;
  /** Ammo count for a magazine, quantity otherwise; null when it has neither. */
  quantity: number | null;
  quantityMax: number | null;
  row: number | null;
  col: number | null;
  /** Resolved from the catalog on read, falling back to what the mod captured. */
  displayName: string | null;
  children: InventoryNode[];
}

/** A stored inventory snapshot without its tree — what the list view renders. */
export interface InventorySummary {
  id: number;
  pid: string;
  name: string | null;
  ts: number;
  reason: 'connect' | 'disconnect' | 'death' | 'manual';
  pos: { x: number; y: number; z: number } | null;
  stats: {
    health: number | null; blood: number | null; shock: number | null;
    energy: number | null; water: number | null;
  };
  /** Node count, denormalised so the list never has to parse a tree. */
  items: number;
  /**
   * The capture hit a node or depth cap, so this loadout is SHORT. A rollback is
   * refused unless the operator explicitly overrides — restoring a knowingly
   * partial loadout and reporting success is how someone ends up believing they
   * undid a bug they only half undid.
   */
  truncated: boolean;
}

export interface InventorySnapshot extends InventorySummary {
  tree: InventoryNode[];
  /** The stored JSON would not parse; metadata is still true, the tree is empty. */
  corrupt?: boolean;
}

/** What the mod reports back after applying a rollback. */
export interface RollbackResult {
  applied: boolean;
  snapshotId: number;
  playerId: string;
  /** Nodes the snapshot held, for comparison against `created`. */
  expected: number;
  result?: string;
  created?: number;
  failed?: number;
  /** Rebuilt, but into cargo because the recorded slot would not take it. */
  misplaced?: number;
  removed?: number;
  error?: string;
  reason?: string;
}

/** Why the history tool has nothing to show. */
export type HistoryUnavailableReason = 'disabled' | 'error' | 'empty' | 'unreachable';

export interface HistoryEnvelope<T> {
  available: boolean;
  reason?: HistoryUnavailableReason;
  error?: string;
  items: T[];
}

/** The four things the map tool can be doing. */
export type HistoryMode = 'paths' | 'playback' | 'area' | 'actions';

/** A circular map selection, in world metres. */
export interface AreaSelection {
  x: number;
  z: number;
  radius: number;
}

/* ------------------------------------------------------------------------- */
/* Loot-cycle detection: flags, evidence, enforcement and policy.              */
/* Mirrors the "API contract" in the loot-cycling plan; server/loot-cycle.js   */
/* is the scorer.                                                              */
/* ------------------------------------------------------------------------- */

/** Severity bands shared by every detector. */
export type FlagSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** One named contribution to a score, with the evidence behind it. */
export interface FlagFactor {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  points: number;
  max: number;
  detail: string | null;
}

/** A pickup paired with the drop or stash that closed it. */
export interface CycleEvidence {
  cls: string;
  iid: number | null;
  pickTs: number;
  dropTs: number;
  heldMs: number;
  fresh: boolean | null;
  pickX: number | null;
  pickZ: number | null;
  dropX: number | null;
  dropZ: number | null;
  distM: number | null;
  kind: 'drop' | 'stash';
  /** How the pair was matched: by the mod's item identity, or by classname FIFO. */
  matched: 'iid' | 'cls';
}

export interface FlagEvidence {
  score: number;
  severity: string;
  /** Set when the mod predates item identity: pairings shown, nothing scored. */
  silent: 'legacy-mod' | null;
  /**
   * The mod dropped events in this window, so the score is a floor and the
   * runner will not escalate on it. Optional: older backends do not send it.
   */
  lossy?: boolean;
  factors: FlagFactor[];
  /**
   * What pulled the score down. `reasons` are the scorer's short keys
   * (`triage`, `atHome`, `stashing`); `notes`, when present, are the same in
   * full sentences and are what the UI prefers to show.
   */
  excuse: { multiplier: number; reasons: string[]; notes?: string[] };
  counts: {
    cycles: number; pickups: number; orphanDrops: number;
    homeDrops: number; stashDrops: number; totalDrops: number;
  };
  cycles: CycleEvidence[];
}

export interface PlayerFlag {
  pid: string;
  name: string | null;
  kind: 'loot_cycle';
  score: number;
  severity: string;
  peak: number;
  /** Ladder position reached this episode; 0 = nothing sent. */
  rung: number;
  episodes: number;
  firstAt: number;
  updatedAt: number;
  /** Operator dismissal time; null while the flag is live. */
  clearedAt: number | null;
  evidence: FlagEvidence | null;
  state: { level: string; smoothed: number; hits: number; peak: number; raisedAt: number | null } | null;
}

export type EnforcementAction = 'notice' | 'warning' | 'kick' | 'tempban' | 'webhook';

export interface EnforcementRow {
  id: number;
  ts: number;
  pid: string;
  flag: string;
  rung: number;
  action: EnforcementAction;
  auto: boolean;
  /** ok | player_not_found | error:<msg>; null while unresolved. */
  result: string | null;
  /** Temp-ban expiry, epoch ms. */
  expires: number | null;
  /** Message text or ban reason. */
  detail: string | null;
}

export interface LadderRung {
  rung: number;
  severity: string;
  action: 'notice' | 'warning' | 'kick' | 'tempban';
  text: string;
  /** False = never fired by the runner; offered as a one-click button instead. */
  auto: boolean;
  minutes?: number;
  repeat?: number;
}

export interface LootCyclePolicy {
  enabled: boolean;
  /** Which profile's CF Tools binding kick/ban resolve through; null = none. */
  profileId: string | null;
  ladder: LadderRung[];
  cooldownMs: number;
  /** The URL itself is write-only; the backend only ever says whether one is set. */
  webhook: { set: boolean; minSeverity: string };
  weights: Record<string, { k: number | null; max: number }> | null;
}

/** What the PUT accepts: the policy, plus a webhook URL to set (string) or clear (null). */
export type LootCyclePolicyUpdate = Partial<Omit<LootCyclePolicy, 'webhook'>> & {
  webhook?: { url?: string | null; minSeverity?: string };
};

export interface LootCycleDetectorStats {
  enabled: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  players: number;
  cursor: number;
  /** Whether any row in the last hour carried the field; false = the mod predates it. */
  capable: { iid: boolean; fresh: boolean; rows: number };
  modConnected: boolean;
}
