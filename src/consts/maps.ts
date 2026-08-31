import deerIsleInfected from '../assets/maps/empty.deerisle/infected.json';
import tileManifests from './mapTiles.json';

/**
 * The maps the tools can draw, and the imagery that backs them.
 *
 * ## Imagery is tiled, and not bundled
 *
 * Map images used to be `import`ed from `src/assets/`, which meant Vite bundled them:
 * 45.7 MB of the old 46 MB `dist/` was map JPEGs, and Deer Isle alone was a 16384x16384 /
 * 42 MiB file that the browser turned into roughly a gigabyte of decoded bitmap.
 *
 * They now live as pre-built tile pyramids under `public/maps/<id>/`, generated from
 * `tools/map-sources/` by `tools/build-map-tiles.py` and committed. Nothing imports them,
 * so nothing bundles them, and `MapImageLayer` fetches only the tiles under the viewport.
 * `mapTiles.json` is the generator's merged manifest — regenerate it, never hand-edit it.
 *
 * ## worldSize is load-bearing
 *
 * Every marker in every tool is positioned as a fraction of `worldSize` (see
 * `utils/mapTransform.ts`), so a wrong value silently puts everything out by hundreds of
 * metres rather than failing visibly. These four are verified against the game's own
 * data — Sakhal in particular is 15360, not the 12800 this file claimed for a long time.
 */

/** One zoom level of a map's tile pyramid. Tiles are `<size>/<col>_<row>.webp`. */
export interface MapTileLevel {
  /** Edge of the square map at this level, in image px. */
  size: number;
  cols: number;
  rows: number;
}

export interface MapTiles {
  /** Edge of the largest level — the zoom ceiling, in image px. */
  nativeSize: number;
  tileSize: number;
  /** Edge of the single un-tiled `base.webp`, always rendered underneath. */
  baseSize: number;
  /** Tiled levels, smallest first. Empty when the source is too small to be worth it. */
  levels: MapTileLevel[];
}

export interface MapMetadata {
  id: string;             // Primary Key (e.g. 'empty.deerisle')
  displayName: string;    // User-friendly name
  worldSize: number;      // Map size in metres (for coordinate scaling)
  imagePath: string;      // The always-loaded base image; '' when there is no imagery
  tiles?: MapTiles;       // Zoom pyramid, when one has been generated
  customInfected?: string[]; // Map-specific custom infected classnames (e.g. from db/events.xml)
}

const manifests = tileManifests as Record<string, MapTiles>;

/**
 * URL of a map's base image. Built from `BASE_URL` rather than hardcoded to `/`, because
 * `vite.config.js` sets `base: './'` so the app can be served from a subfolder.
 */
export function baseImageUrl(id: string): string {
  return `${import.meta.env.BASE_URL}maps/${id}/base.webp`;
}

/** URL of one tile. `MapImageLayer` is the only caller. */
export function tileUrl(id: string, level: number, col: number, row: number): string {
  return `${import.meta.env.BASE_URL}maps/${id}/${level}/${col}_${row}.webp`;
}

function entry(
  id: string,
  displayName: string,
  worldSize: number,
  extra: Partial<MapMetadata> = {},
): MapMetadata {
  const tiles = manifests[id];
  return {
    id,
    displayName,
    worldSize,
    imagePath: tiles ? baseImageUrl(id) : '',
    tiles,
    ...extra,
  };
}

export const MAP_REGISTRY: Record<string, MapMetadata> = {
  'empty.deerisle': entry('empty.deerisle', 'Deer Isle', 16384, {
    customInfected: deerIsleInfected.customInfected,
  }),
  'dayzoffline.enoch': entry('dayzoffline.enoch', 'Livonia', 12800),
  'dayzoffline.chernarusplus': entry('dayzoffline.chernarusplus', 'Chernarus+', 15360),
  // 15360, not 12800: object positions in the game's own ce/mapgrouppos.xml reach ~15000 m,
  // and fitting them against the map imagery lands the world square exactly on the terrain.
  'dayzoffline.sakhal': entry('dayzoffline.sakhal', 'Sakhal', 15360),
};

/**
 * Alternative mission names that mean the same map. Servers do not agree on a spelling,
 * and an unrecognised name used to fall through to a generic 15360 map with no imagery.
 */
const ALIASES: Record<string, string> = {
  chernarusplus: 'dayzoffline.chernarusplus',
  chernarus: 'dayzoffline.chernarusplus',
  enoch: 'dayzoffline.enoch',
  livonia: 'dayzoffline.enoch',
  sakhal: 'dayzoffline.sakhal',
  deerisle: 'empty.deerisle',
};

export const DEFAULT_MAP: MapMetadata = {
  id: 'unknown',
  displayName: 'Generic Map',
  worldSize: 15360,
  imagePath: '',
};

export function getMapMetadata(missionName?: string): MapMetadata {
  if (!missionName) return DEFAULT_MAP;
  const key = missionName.toLowerCase();
  const direct = MAP_REGISTRY[key];
  if (direct) return direct;

  // Mission names are often '<prefix>.<world>' with a prefix nobody agrees on; match on
  // the world part before giving up.
  const suffix = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  const aliased = ALIASES[suffix];
  if (aliased) return MAP_REGISTRY[aliased];

  return { ...DEFAULT_MAP, id: key, displayName: missionName };
}
