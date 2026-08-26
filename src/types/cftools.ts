// Shapes served by the backend's /api/cftools/* proxy (see server/cftools-service.js).
// Everything is already normalized server-side; positions are DayZ world metres [x, y, z]
// (y = height) — map projection uses [0] and [2].

export interface LivePlayer {
  sessionId: string | null;
  cftoolsId: string | null;
  name: string;
  steamId: string | null;
  /** Absent while the player is still loading in — omit the marker, keep the roster row. */
  position: [number, number, number] | null;
  /** GlobalHealth 0–100. Sourced from the companion mod's snapshot; null when it isn't connected. */
  health: number | null;
  /** Classname of the item in hands. Same source as `health`; null when empty-handed or unknown. */
  handItem: string | null;
  /** Friendly name for `handItem`, resolved from the mod catalog. Null when the catalog has no entry. */
  handItemLabel: string | null;
  /** Blood, ~0–5000. Same source as `health`. */
  blood: number | null;
  /** Shock, ~0–100. Same source as `health`. */
  shock: number | null;
  /** Energy stat; null when the engine doesn't declare it (the mod sends -1). */
  energy: number | null;
  /** Water stat; null when the engine doesn't declare it (the mod sends -1). */
  water: number | null;
  /** False only when the mod explicitly reports a dead player; null when unknown. */
  alive: boolean | null;
  ping: number | null;
  loaded: boolean;
  banCount: number | null;
}

export interface LiveVehicle {
  id: string | null;
  className: string | null;
  displayName: string | null;
  position: [number, number, number];
  speed: number | null;
  health: number | null;
}

/** A player referenced from a territory tooltip. Either half may be absent: the mod
 *  omits UIDs when `territory_show_uids` is off, and prints a bare UID when Expansion
 *  has no name for that member. */
export interface LivePlayerRef {
  name: string | null;
  steamId: string | null;
}

export interface LiveTerritoryMember extends LivePlayerRef {
  /** 'Admin' | 'Moderator' | 'Member' — plain words, not Expansion's #STR_ keys.
   *  Empty/null under a territory system that has permissions instead of ranks. */
  rank: string | null;
  /** The territory system's own key for this member. Under BasicTerritories and
   *  Expansion alike this is a BI GUID, NOT a steam64 — which is why `name` may be
   *  null even though the member plainly exists. Only present on mod-sourced rows. */
  id?: string | null;
  /** BasicTerritories permission bitmask; null under a ranks-based system. */
  permissions?: number | null;
  /** The bitmask already decoded into words by the mod, e.g. ['build','dismantle'].
   *  Prefer these over `permissions` — the bit layout is the territory mod's private
   *  ABI and is deliberately not replicated here. */
  permissionNames?: string[];
  /** Whether this member is connected right now. */
  online?: boolean | null;
}

/**
 * Territory detail, from either of two sources: the enriched GameLabs tooltip that
 * `spacecat_gamelabs` publishes, or `territories[]` on the companion mod's snapshot
 * (which wins per-field where both have a value).
 *
 * Every field is independently optional. The mod's config can switch parts off
 * (`territory_show_members`, `territory_show_uids`), tooltip parsing is best-effort,
 * and the two territory systems genuinely expose different things — Expansion has a
 * name/id/level and ranks, BasicTerritories has none of those but has permissions.
 */
export interface LiveTerritoryInfo {
  name: string | null;
  /** Refresher charge, whole percent. */
  flagLevel: number | null;
  /** Remaining lifetime, whole hours. Tooltip-only; the mod does not compute it. */
  lifetimeHours: number | null;
  owner: LiveTerritoryMember | LivePlayerRef | null;
  territoryId: number | null;
  level: number | null;
  /** Roster size excluding the owner. Can exceed `members.length` when a display cap
   *  applied — see `membersOmitted` (tooltip) and `membersTruncated` (mod). */
  memberCount: number | null;
  /** Roster excluding the owner. */
  members: LiveTerritoryMember[];
  /** How many members the tooltip dropped to honour `territory_max_members`. */
  membersOmitted: number;

  // ---- mod-sourced only (absent on tooltip-only rows) ----
  /** Base-building objects inside the territory radius. null = never scanned, which
   *  is NOT the same as 0 — the mod scans on a budgeted round-robin, not per tick. */
  objectCount?: number | null;
  /** Cargo items across those objects. Same null-vs-0 distinction. */
  cargoCount?: number | null;
  /** Radius the counts were taken at, metres. Worth preferring over the server-wide
   *  Expansion setting when two territory mods with different sizes are live. */
  radius?: number | null;
  /** Seconds since that scan; null when never scanned. */
  scanAge?: number | null;
  /** The roster was longer than the mod's own cap. */
  membersTruncated?: boolean;
  /** Which territory system registered this flag: 'basic' | 'expansion' | 'unknown'. */
  source?: string;
}

/**
 * An Expansion AI character, from the companion mod's snapshot only — CF Tools has no
 * concept of them. Carries the same stat block as LivePlayer so both render through
 * one code path; rendered as a green map dot against the player's orange.
 */
export interface LiveAi {
  /** Stable for the entity's lifetime. Marker key and selection id. */
  id: string | null;
  name: string;
  className: string | null;
  faction: string | null;
  group: string | null;
  groupId: number | null;
  position: [number, number, number];
  health: number | null;
  blood: number | null;
  shock: number | null;
  energy: number | null;
  water: number | null;
  alive: boolean | null;
  handItem: string | null;
  handItemLabel: string | null;
  /** 'expansion' = an exact eAIBase check; 'heuristic' = the mod's classname fallback. */
  source: string;
}

export interface LiveEvent {
  id: string | null;
  /** 'helicrash' | 'contaminated_area' | 'territory_flag' | custom _Event types | 'unknown' */
  type: string;
  className: string | null;
  displayName: string | null;
  position: [number, number, number];
  /**
   * True when the entity has left its first-seen (spawn) position — it was
   * picked up, dropped elsewhere, or stored. From the server's spawn ledger;
   * absent for entities without a stable id.
   */
  moved?: boolean;
  /** First position the backend ever observed for this entity. */
  spawnPosition?: [number, number, number];
  /** Present on territory flags the backend could resolve from either source. */
  territory?: LiveTerritoryInfo;
  /** Where this row came from: 'gamelabs' (tooltip), 'mod' (companion-mod snapshot),
   *  or 'mixed' (both, merged). Only set on territory rows. */
  origin?: string;
}

/** One map layer's payload; `stale` = served from cache during a rate-limit/outage. */
export interface LiveLayer<T> {
  at?: number;
  stale?: boolean;
  /** Set when this layer's upstream failed; items is then []. */
  error?: string;
  /** Which source produced the items: 'gamelabs' | 'mod' | 'mixed'. Territories only. */
  source?: string;
  items: T[];
}

export interface LiveSnapshot {
  connected: boolean;
  reason?: string;
  players?: LiveLayer<LivePlayer>;
  vehicles?: LiveLayer<LiveVehicle>;
  events?: LiveLayer<LiveEvent>;
  territories?: LiveLayer<LiveEvent>;
  ai?: LiveLayer<LiveAi>;
}

export type LiveLayerKey = 'players' | 'vehicles' | 'events' | 'territories' | 'ai';
