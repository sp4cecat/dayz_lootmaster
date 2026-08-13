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

export interface LiveEvent {
  id: string | null;
  /** 'helicrash' | 'contaminated_area' | 'territory_flag' | custom _Event types | 'unknown' */
  type: string;
  className: string | null;
  displayName: string | null;
  position: [number, number, number];
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
