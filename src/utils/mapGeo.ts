/**
 * World-space formatting and geometry for the map tools.
 *
 * Split out from the components for the same reason as `@/utils/mapTransform`: jsdom has no
 * layout, so pure functions are the only part of a map feature that can be meaningfully
 * unit-tested.
 *
 * ## The coordinate-order trap
 *
 * DayZ writes positions as `x y z` with **y as the height**, so the two horizontal axes are
 * the first and last components. The GameLabs wire format disagrees — it packs world Z into
 * `valueVectorY` and the height into `valueVectorZ` (see `toWireParam` in
 * `components/live/RawActionPanel.tsx`). Everything user-facing formats through this module
 * so the swap lives in exactly those two places and nowhere else.
 */

/** A horizontal world position in metres. Y (height) is deliberately absent. */
export interface WorldPoint {
  x: number;
  z: number;
}

/**
 * A position in the game's own `x y z` order, e.g. `"7412 0 9834"`.
 *
 * Height defaults to 0, which every DayZ spawn path treats as "snap to the surface" — the
 * right default for a point picked off a top-down map, where the terrain height is unknown.
 */
export function formatWorldPos(x: number, z: number, y = 0): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toString();
  return `${n(x)} ${n(y)} ${n(z)}`;
}

/**
 * A `<pos>` element in the `cfgeventspawns.xml` shape, ready to paste into a mission file.
 *
 * That schema carries no height — the CE derives it from the terrain — so this is x/z/a
 * only. `a` is the yaw in degrees.
 */
export function formatPosXml(x: number, z: number, a = 0): string {
  const n = (v: number) => v.toFixed(1);
  return `<pos x="${n(x)}" z="${n(z)}" a="${n(a)}" />`;
}

/**
 * Planar distance in metres and the compass bearing from `from` to `to`.
 *
 * World +Z is north and +X is east, so the bearing is `atan2(east, north)` — arguments in
 * that order, not the usual `atan2(y, x)` — measured clockwise from north and normalised to
 * [0, 360). Height is ignored: this is a map measurement, not a line of sight.
 */
export function distanceBearing(from: WorldPoint, to: WorldPoint): {
  metres: number;
  bearingDeg: number;
} {
  const east = to.x - from.x;
  const north = to.z - from.z;
  const bearing = (Math.atan2(east, north) * 180) / Math.PI;
  return {
    metres: Math.hypot(east, north),
    // atan2 returns (-180, 180]; the modulo brings west-of-north back into range.
    bearingDeg: (bearing + 360) % 360,
  };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The nearest 45° compass point for a bearing in degrees. */
export const compassPoint = (bearingDeg: number) =>
  COMPASS[Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8];

/** A distance for display: metres under a kilometre, then kilometres to 2 dp. */
export const formatDistance = (metres: number) =>
  (metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`);
