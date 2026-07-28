/**
 * Spatial index over the Heat Map's points, so the hover readout can answer "how many logged
 * events are within r of here?" without walking the whole array on every dwell.
 *
 * Everything is in **unit-square space** — the same normalised coordinates `HeatMapModal`
 * already rasterises from (`x / worldSize`, `1 - z / worldSize`), so the index is independent
 * of both the map's metre extent and the current zoom.
 */

export interface UnitPoint {
  x: number;
  y: number;
}

export interface PointGrid {
  /** Buckets per axis. */
  cells: number;
  /** Row-major `cells * cells` buckets; a bucket is undefined until something lands in it. */
  buckets: (UnitPoint[] | undefined)[];
  /** Kept for callers that want to short-circuit on an empty dataset. */
  count: number;
}

/** 256² buckets ≈ 64 m cells on a 16384 m map — small enough that a hover touches only a few. */
const DEFAULT_CELLS = 256;

const cellIndex = (v: number, cells: number) =>
  Math.min(cells - 1, Math.max(0, Math.floor(v * cells)));

/**
 * Bucket points into a uniform grid. Points outside the unit square (a log position beyond the
 * map extent) are clamped into the edge buckets rather than dropped, so the count still sees
 * them — the raster does the same thing by simply drawing them off-canvas.
 */
export function buildPointGrid(points: UnitPoint[], cells: number = DEFAULT_CELLS): PointGrid {
  const buckets: (UnitPoint[] | undefined)[] = new Array(cells * cells);
  for (const p of points) {
    const i = cellIndex(p.y, cells) * cells + cellIndex(p.x, cells);
    (buckets[i] ??= []).push(p);
  }
  return { cells, buckets, count: points.length };
}

/**
 * Count the points within `radius` of `(ux, uy)`, all in unit-square units.
 *
 * This is deliberately "centre within radius" rather than anything gradient-weighted: a blob
 * covers a given pixel exactly when its centre is within the blob radius of it, so the number
 * is precisely how many events contribute to the heat under the cursor.
 */
export function countWithinRadius(grid: PointGrid, ux: number, uy: number, radius: number): number {
  if (grid.count === 0 || !(radius > 0)) return 0;

  const { cells, buckets } = grid;
  const x0 = cellIndex(ux - radius, cells);
  const x1 = cellIndex(ux + radius, cells);
  const y0 = cellIndex(uy - radius, cells);
  const y1 = cellIndex(uy + radius, cells);

  const r2 = radius * radius;
  let count = 0;
  for (let cy = y0; cy <= y1; cy++) {
    const row = cy * cells;
    for (let cx = x0; cx <= x1; cx++) {
      const bucket = buckets[row + cx];
      if (!bucket) continue;
      for (const p of bucket) {
        const dx = p.x - ux;
        const dy = p.y - uy;
        if (dx * dx + dy * dy <= r2) count++;
      }
    }
  }
  return count;
}
