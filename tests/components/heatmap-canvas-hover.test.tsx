import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The modal fetches on demand; every test drives it through the same canned response.
const COORDS: { x: number; z: number }[] = [];
vi.mock('../../src/utils/api', () => ({
  getApiBase: () => '',
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ coords: COORDS }) })),
}));

import HeatMapModal from '../../src/components/HeatMapModal';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOX = 600;
/** A registered map, so there's a real image for the pan/zoom hook to measure a zoom range from. */
const MISSION = 'dayzoffline.chernarusplus';
const WORLD = 15360;
const NATIVE = 4096;

/** Every canvas op the heat map performs, recorded so the tests can assert on the raster. */
const calls = {
  gradients: [] as { r: number }[],
  drawImage: [] as { x: number; y: number }[],
};

function fakeContext() {
  return {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    globalCompositeOperation: '',
    fillStyle: '' as unknown,
    createRadialGradient(_x0: number, _y0: number, _r0: number, _x1: number, _y1: number, r1: number) {
      calls.gradients.push({ r: r1 });
      return { addColorStop() {} };
    },
    drawImage(_img: unknown, x: number, y: number) {
      calls.drawImage.push({ x, y });
    },
  };
}

/**
 * jsdom has no layout engine, no ResizeObserver, no PointerEvent, no pointer capture and no
 * canvas rasteriser. All browser plumbing — none of it is component behaviour.
 */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => BOX });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => BOX });
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: BOX, bottom: BOX, width: BOX, height: BOX,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLCanvasElement.prototype.getContext = (() => fakeContext()) as unknown as HTMLCanvasElement['getContext'];
});

/** jsdom has no PointerEvent constructor; React 19 listens for the native type name. */
function pointer(el: Element, type: string, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'button', { value: 0 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(e);
}

/** Flush the rAF the heat map coalesces its redraw into. */
async function frame() {
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
}

async function mount(coords: { x: number; z: number }[]) {
  COORDS.length = 0;
  COORDS.push(...coords);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HeatMapModal onClose={() => {}} selectedProfileId="p1" missionName={MISSION} isPanel />
    );
  });

  // jsdom never loads the <img>, so the hook would never learn a natural size and zoom would
  // stay disabled. Fake the load with a 4096px source.
  const img = container.querySelector('img');
  if (img) {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: NATIVE });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: NATIVE });
    await act(async () => { img.dispatchEvent(new Event('load')); });
  }

  const buttons = Array.from(container.querySelectorAll('button'));
  const fetchBtn = buttons.find(b => /Fetch Data/.test(b.textContent || ''));
  await act(async () => { fetchBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await frame();

  const viewport = container.querySelector('canvas')!.parentElement as HTMLElement;
  return { container, viewport, root };
}

const tooltipText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div'))
    .map(d => d.textContent || '')
    .find(t => /^\d+ events?$/.test(t)) ?? null;

/** Centre of the map, so a 600px viewport puts it at (300, 300). */
const CENTRE = WORLD / 2;

describe('HeatMapModal raster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.gradients.length = 0;
    calls.drawImage.length = 0;
    document.body.innerHTML = '';
  });
  afterEach(() => { vi.useRealTimers(); });

  it('draws a blob per point at the projected position', async () => {
    await mount([{ x: CENTRE, z: CENTRE }]);
    expect(calls.drawImage).toHaveLength(1);
    // Sprite is 2r+2 = 22px, so its top-left sits 11px up and left of the point.
    expect(calls.drawImage[0].x).toBeCloseTo(300 - 11, 5);
    expect(calls.drawImage[0].y).toBeCloseTo(300 - 11, 5);
  });

  it('keeps the blob radius constant when zooming, rather than scaling it with the map', async () => {
    // Two points 200m apart, either side of the map centre. Zooming about the viewport centre
    // leaves the centre fixed, so the pair must spread apart while each blob stays the same size.
    const { container } = await mount([
      { x: CENTRE - 100, z: CENTRE },
      { x: CENTRE + 100, z: CENTRE },
    ]);
    expect(calls.gradients.at(-1)!.r).toBe(10); // the default radius, in real screen px

    const spread = (c: typeof calls.drawImage) => Math.abs(c[1].x - c[0].x);
    const beforeSpread = spread(calls.drawImage);
    // Stamp origin is the point minus half the sprite, so this pins the blob's size on screen.
    const beforeOffset = calls.drawImage[0].x + beforeSpread / 2;

    const zoomIn = container.querySelector('button[title="Zoom in"]') as HTMLElement;
    expect(zoomIn).toBeTruthy();
    calls.drawImage.length = 0;
    await act(async () => { zoomIn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await frame();

    // Terrain distance grew with the zoom...
    expect(spread(calls.drawImage)).toBeGreaterThan(beforeSpread * 1.4);
    // ...but the sprite didn't: same 11px half-sprite offset from the same fixed centre, and no
    // rebuilt gradient at a different radius.
    expect(calls.drawImage[0].x + spread(calls.drawImage) / 2).toBeCloseTo(beforeOffset, 5);
    expect(calls.gradients.at(-1)!.r).toBe(10);
  });

  it('skips points outside the viewport', async () => {
    // One point at the centre, one in the top-left corner of the world.
    await mount([{ x: CENTRE, z: CENTRE }, { x: 40, z: WORLD - 40 }]);
    expect(calls.drawImage).toHaveLength(2);

    const { container, viewport } = await mount([{ x: CENTRE, z: CENTRE }, { x: 40, z: WORLD - 40 }]);
    calls.drawImage.length = 0;
    // Zoom in on the centre; the corner point is pushed well off screen.
    const zoomIn = container.querySelector('button[title="Zoom in"]') as HTMLElement;
    await act(async () => { zoomIn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await frame();
    expect(viewport).toBeTruthy();
    expect(calls.drawImage).toHaveLength(1);
  });
});

describe('HeatMapModal hover readout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.gradients.length = 0;
    calls.drawImage.length = 0;
    document.body.innerHTML = '';
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the count of events under the blob after a two-second dwell', async () => {
    // Three events within a few metres of the map centre, one far away.
    const near = [
      { x: CENTRE, z: CENTRE },
      { x: CENTRE + 20, z: CENTRE },
      { x: CENTRE, z: CENTRE - 20 },
    ];
    const { container, viewport } = await mount([...near, { x: 500, z: 500 }]);

    await act(async () => { pointer(viewport, 'pointermove', 300, 300); });
    // Nothing yet — the whole point is that it waits.
    await act(async () => { await vi.advanceTimersByTimeAsync(1900); });
    expect(tooltipText(container)).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(tooltipText(container)).toBe('3 events');
  });

  it('says nothing over cold map', async () => {
    const { container, viewport } = await mount([{ x: 500, z: 500 }]);
    await act(async () => { pointer(viewport, 'pointermove', 300, 300); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(tooltipText(container)).toBeNull();
  });

  it('hides on movement and re-arms the dwell', async () => {
    const { container, viewport } = await mount([{ x: CENTRE, z: CENTRE }]);

    await act(async () => { pointer(viewport, 'pointermove', 300, 300); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(tooltipText(container)).toBe('1 event');

    // Jitter under the slop shouldn't disturb a readout the user is reading.
    await act(async () => { pointer(viewport, 'pointermove', 301, 301); });
    expect(tooltipText(container)).toBe('1 event');

    // A real move does.
    await act(async () => { pointer(viewport, 'pointermove', 340, 340); });
    expect(tooltipText(container)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(tooltipText(container)).toBeNull(); // 340,340 is off the blob
  });

  it('drops the readout when the map pans out from under it', async () => {
    const { container, viewport } = await mount([{ x: CENTRE, z: CENTRE }]);
    await act(async () => { pointer(viewport, 'pointermove', 300, 300); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(tooltipText(container)).toBe('1 event');

    const zoomIn = container.querySelector('button[title="Zoom in"]') as HTMLElement;
    await act(async () => { zoomIn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(tooltipText(container)).toBeNull();
  });
});
