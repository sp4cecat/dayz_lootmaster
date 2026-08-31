import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MapImageLayer from '../../src/components/map/MapImageLayer';
import { useMapPanZoom, type MapPanZoom } from '../../src/hooks/useMapPanZoom';
import { getMapMetadata } from '../../src/consts/maps';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOX = 600;
/** Deer Isle: the one bundled map with a pyramid deep enough to change levels. */
const MAP = getMapMetadata('empty.deerisle');

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => BOX });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => BOX });
});

let view: MapPanZoom;

function Harness() {
  const v = useMapPanZoom({ worldSize: MAP.worldSize, nativeSize: MAP.tiles?.nativeSize });
  view = v;
  return (
    <div ref={v.viewportRef} {...v.viewportHandlers} data-testid="viewport">
      <MapImageLayer view={v} map={MAP} />
    </div>
  );
}

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => { createRoot(container).render(<Harness />); });
  return container;
}

/** Every tile currently rendered, as `{ level, col, row, left, top, w, h }`. */
function tiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('img[aria-hidden="true"]')).map((el) => {
    const img = el as HTMLImageElement;
    const m = /\/maps\/[^/]+\/(\d+)\/(\d+)_(\d+)\.webp$/.exec(img.getAttribute('src') || '');
    if (!m) throw new Error(`unexpected tile src: ${img.getAttribute('src')}`);
    return {
      level: Number(m[1]), col: Number(m[2]), row: Number(m[3]),
      left: parseFloat(img.style.left), top: parseFloat(img.style.top),
      w: parseFloat(img.style.width), h: parseFloat(img.style.height),
    };
  });
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('MapImageLayer', () => {
  it('always renders the base image, so the viewport is never blank', async () => {
    const c = await render();
    const base = c.querySelector('img:not([aria-hidden])') as HTMLImageElement;
    expect(base).toBeTruthy();
    expect(base.getAttribute('src')).toBe(MAP.imagePath);
  });

  it('picks the smallest level that can fill the box without upscaling', async () => {
    const c = await render();
    // Fit-to-view is a 600px content box, so 2048 is the first level that covers it.
    expect(new Set(tiles(c).map(t => t.level))).toEqual(new Set([2048]));

    // 600 * 4 = 2400px of content, past 2048 and into 4096.
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: 4 }); });
    expect(new Set(tiles(c).map(t => t.level))).toEqual(new Set([4096]));

    // Past the top of the pyramid, the largest level is reused rather than upscaled past it.
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: view.maxScale }); });
    expect(new Set(tiles(c).map(t => t.level))).toEqual(new Set([8192]));
  });

  it('lays adjacent tiles edge to edge, with no sub-pixel seam between them', async () => {
    const c = await render();
    const grid = tiles(c);
    const row0 = grid.filter(t => t.row === 0).sort((a, b) => a.col - b.col);
    expect(row0.length).toBeGreaterThan(1);
    for (let i = 1; i < row0.length; i++) {
      // A gap OR an overlap here is a visible hairline at some zoom levels; the point of
      // rounding both edges from the same division is that this is exact, not close.
      expect(row0[i].left).toBe(row0[i - 1].left + row0[i - 1].w);
    }

    const col0 = grid.filter(t => t.col === 0).sort((a, b) => a.row - b.row);
    for (let i = 1; i < col0.length; i++) {
      expect(col0[i].top).toBe(col0[i - 1].top + col0[i - 1].h);
    }
  });

  it('covers the whole content box at fit, leaving no unpainted edge', async () => {
    const c = await render();
    const grid = tiles(c);
    const right = Math.max(...grid.map(t => t.left + t.w));
    const bottom = Math.max(...grid.map(t => t.top + t.h));
    expect(Math.min(...grid.map(t => t.left))).toBe(0);
    expect(Math.min(...grid.map(t => t.top))).toBe(0);
    expect(right).toBe(view.contentSize);
    expect(bottom).toBe(view.contentSize);
  });

  it('renders only the tiles under the viewport once zoomed in', async () => {
    const c = await render();
    const atFit = tiles(c).length;

    // 8192/512 = 16x16 = 256 tiles exist at this level; a 600px viewport sees a handful.
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: view.maxScale }); });
    const zoomed = tiles(c);
    expect(zoomed.length).toBeGreaterThan(0);
    expect(zoomed.length).toBeLessThan(256);

    // Pinned to the top-left corner, so it is the top-left tiles that are drawn.
    expect(zoomed.every(t => t.col < 8 && t.row < 8)).toBe(true);
    expect(atFit).toBeGreaterThan(0);
  });

  it('follows a pan to a different corner of the map', async () => {
    const c = await render();
    await act(async () => { view.applyTransform({ x: 0, y: 0, scale: view.maxScale }); });
    const topLeft = tiles(c);

    // Drag the bottom-right of the map into view; clampTransform pins it at the edge.
    await act(async () => { view.applyTransform({ x: -1e6, y: -1e6, scale: view.maxScale }); });
    const bottomRight = tiles(c);

    expect(Math.max(...bottomRight.map(t => t.col))).toBe(15);
    expect(Math.max(...bottomRight.map(t => t.row))).toBe(15);
    expect(Math.max(...topLeft.map(t => t.col))).toBeLessThan(15);
  });

  // Sakhal's top level is 3713px, i.e. 7.25 tiles across, so its eighth column is 129px of
  // image rather than 512. Sizing that as a full tile stretches the map's east and south
  // edges — and because Deer Isle divides evenly at every level, only Sakhal catches it.
  describe('a level that is not a whole number of tiles across', () => {
    const SAKHAL = getMapMetadata('dayzoffline.sakhal');

    function SakhalHarness() {
      const v = useMapPanZoom({ worldSize: SAKHAL.worldSize, nativeSize: SAKHAL.tiles?.nativeSize });
      view = v;
      return (
        <div ref={v.viewportRef} {...v.viewportHandlers}>
          <MapImageLayer view={v} map={SAKHAL} />
        </div>
      );
    }

    it('gives the partial edge tile its true width, and still covers the box exactly', async () => {
      const c = document.createElement('div');
      document.body.appendChild(c);
      await act(async () => { createRoot(c).render(<SakhalHarness />); });
      await act(async () => { view.applyTransform({ x: 0, y: 0, scale: view.maxScale }); });
      // Pin the bottom-right corner into view so the partial tiles are the ones drawn.
      await act(async () => { view.applyTransform({ x: -1e6, y: -1e6, scale: view.maxScale }); });

      const grid = tiles(c).filter(t => t.level === 3713);
      expect(grid.length).toBeGreaterThan(0);

      const last = grid.filter(t => t.col === 7).sort((a, b) => a.row - b.row);
      const full = grid.filter(t => t.col === 6).sort((a, b) => a.row - b.row);
      expect(last.length).toBeGreaterThan(0);
      expect(full.length).toBeGreaterThan(0);
      // 3713 - 7*512 = 129 of a 512px tile.
      expect(last[0].w / full[0].w).toBeCloseTo(129 / 512, 2);

      // And the right-hand edge still lands exactly on the edge of the content box.
      expect(last[0].left + last[0].w).toBe(view.contentSize);
    });
  });

  it('renders no tiles for a map with no pyramid, but still shows its base image', async () => {
    const chernarus = getMapMetadata('dayzoffline.chernarusplus');
    expect(chernarus.tiles?.levels).toEqual([]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <div><MapImageLayer view={view} map={chernarus} /></div>
      );
    });
    expect(tiles(container)).toEqual([]);
    expect(container.querySelector('img:not([aria-hidden])')).toBeTruthy();
  });
});
