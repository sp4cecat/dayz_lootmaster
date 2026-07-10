/**
 * Live world-item scan types, mirroring the `ItemInfo` / `ItemScan` schemas in
 * openapi.json. Produced on demand by the companion mod's scanItems sweep and
 * served by the backend's GET /items and GET /items/near/{playerId} routes.
 */

export type DamageState =
  | 'pristine'
  | 'worn'
  | 'damaged'
  | 'badly_damaged'
  | 'ruined'
  | 'unknown';

/** A spawned world item found by a region scan. */
export interface ItemInfo {
  /** Config class name (GetType). */
  cls: string;
  /** Localized in-game name. */
  displayName?: string;
  /** World position [x, y, z]. */
  pos: [number, number, number];
  /** 0 = pristine .. 4 = ruined. */
  healthLevel?: number;
  damageState?: DamageState;
  /** Configured CE lifetime in seconds (types.xml <lifetime>); NOT the live remaining TTL. */
  lifetimeMax?: number;
}

/** Result of a single region scan. */
export interface ItemScan {
  center: { x: number; z: number };
  radius: number;
  count: number;
  items: ItemInfo[];
}
