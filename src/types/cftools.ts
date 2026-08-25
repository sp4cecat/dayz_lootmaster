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
  /** 'Admin' | 'Moderator' | 'Member' — plain words, not Expansion's #STR_ keys. */
  rank: string;
}

/**
 * Territory detail parsed from the enriched GameLabs tooltip that `spacecat_gamelabs`
 * publishes. Every field is optional because the mod's config can switch parts off
 * (`territory_show_members`, `territory_show_uids`) and because parsing is best-effort.
 */
export interface LiveTerritoryInfo {
  name: string | null;
  /** Refresher charge, whole percent. */
  flagLevel: number | null;
  /** Remaining lifetime, whole hours. */
  lifetimeHours: number | null;
  owner: LivePlayerRef | null;
  territoryId: number | null;
  level: number | null;
  /** Expansion's own count — includes the owner and ignores the display cap, so it
   *  can exceed `members.length`. */
  memberCount: number | null;
  /** Roster excluding the owner, capped by the mod's `territory_max_members`. */
  members: LiveTerritoryMember[];
  /** How many members the mod dropped to honour that cap. */
  membersOmitted: number;
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
  /** Present on territory flags whose tooltip the backend could parse. */
  territory?: LiveTerritoryInfo;
}

/** One map layer's payload; `stale` = served from cache during a rate-limit/outage. */
export interface LiveLayer<T> {
  at?: number;
  stale?: boolean;
  /** Set when this layer's upstream failed; items is then []. */
  error?: string;
  items: T[];
}

export interface LiveSnapshot {
  connected: boolean;
  reason?: string;
  players?: LiveLayer<LivePlayer>;
  vehicles?: LiveLayer<LiveVehicle>;
  events?: LiveLayer<LiveEvent>;
  territories?: LiveLayer<LiveEvent>;
}

export type LiveLayerKey = 'players' | 'vehicles' | 'events' | 'territories';
