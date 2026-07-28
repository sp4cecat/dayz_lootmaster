import { describe, it, expect } from 'vitest';
import { buildPointGrid, countWithinRadius } from '../../src/utils/heatMapField';

/**
 * The Heat Map's hover readout answers "how many logged events are under the blob here?".
 * The grid is only an accelerator — these tests pin the answer to brute force, so a bucketing
 * bug can't quietly under-count near a cell boundary.
 */

const brute = (points: { x: number; y: number }[], ux: number, uy: number, r: number) =>
  points.filter(p => Math.hypot(p.x - ux, p.y - uy) <= r).length;

describe('heatMapField', () => {
  it('counts nothing in an empty dataset', () => {
    const grid = buildPointGrid([]);
    expect(grid.count).toBe(0);
    expect(countWithinRadius(grid, 0.5, 0.5, 0.1)).toBe(0);
  });

  it('counts points inside the radius and excludes those outside', () => {
    const points = [
      { x: 0.5, y: 0.5 },   // dead centre
      { x: 0.52, y: 0.5 },  // 0.02 away
      { x: 0.5, y: 0.56 },  // 0.06 away
      { x: 0.9, y: 0.9 },   // far
    ];
    const grid = buildPointGrid(points);
    expect(countWithinRadius(grid, 0.5, 0.5, 0.05)).toBe(2);
    expect(countWithinRadius(grid, 0.5, 0.5, 0.1)).toBe(3);
  });

  it('uses a circular test, not the square of cells it visits', () => {
    // Diagonally 0.0707 away — inside the 0.06-wide cell block, outside a 0.06 circle.
    const grid = buildPointGrid([{ x: 0.55, y: 0.55 }]);
    expect(countWithinRadius(grid, 0.5, 0.5, 0.06)).toBe(0);
    expect(countWithinRadius(grid, 0.5, 0.5, 0.08)).toBe(1);
  });

  it('counts duplicate positions separately', () => {
    const grid = buildPointGrid([
      { x: 0.25, y: 0.25 },
      { x: 0.25, y: 0.25 },
      { x: 0.25, y: 0.25 },
    ]);
    expect(countWithinRadius(grid, 0.25, 0.25, 0.001)).toBe(3);
  });

  it('agrees with brute force across the map, including cell boundaries and edges', () => {
    // Deterministic pseudo-random spread; no Math.random so a failure is reproducible.
    const points = Array.from({ length: 500 }, (_, i) => ({
      x: ((i * 97) % 1000) / 1000,
      y: ((i * 613) % 1000) / 1000,
    }));
    // Points sitting exactly on a 256-cell boundary, which is where bucketing goes wrong.
    points.push({ x: 4 / 256, y: 4 / 256 }, { x: 0, y: 0 }, { x: 1, y: 1 });

    const grid = buildPointGrid(points);
    const probes = [
      [0.5, 0.5], [0, 0], [1, 1], [4 / 256, 4 / 256], [0.999, 0.001], [0.123, 0.876],
    ] as const;
    for (const [ux, uy] of probes) {
      for (const r of [0.002, 0.02, 0.15]) {
        expect(countWithinRadius(grid, ux, uy, r)).toBe(brute(points, ux, uy, r));
      }
    }
  });

  it('still sees points that fall outside the map extent', () => {
    // A log position beyond worldSize normalises past the unit square; it's clamped into the
    // edge bucket rather than dropped, so a hover right on the edge still counts it.
    const grid = buildPointGrid([{ x: 1.01, y: 0.5 }]);
    expect(countWithinRadius(grid, 1, 0.5, 0.02)).toBe(1);
    expect(countWithinRadius(grid, 0.9, 0.5, 0.02)).toBe(0);
  });

  it('treats a zero or negative radius as no hit', () => {
    const grid = buildPointGrid([{ x: 0.5, y: 0.5 }]);
    expect(countWithinRadius(grid, 0.5, 0.5, 0)).toBe(0);
    expect(countWithinRadius(grid, 0.5, 0.5, -1)).toBe(0);
  });
});
