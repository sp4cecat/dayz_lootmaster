import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PlayerHistoryView from '../../src/components/history/PlayerHistoryView';
import TrackLayer from '../../src/components/history/TrackLayer';
import { MAX_TRACKS, trackColors } from '../../src/utils/trackColors';
import type { HistoryTrack } from '../../src/types/history';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOX = 600;

/**
 * jsdom has no layout, no ResizeObserver, no PointerEvent and no rAF worth the name,
 * so the map hook can neither measure itself nor receive gestures without these.
 * Everything stubbed here is browser plumbing, not behaviour under test — the same
 * set map-pan-zoom.test.tsx installs.
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
});

function pointer(el: Element, type: string, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'button', { value: 0 });
  el.dispatchEvent(e);
}

const STATS_OK = {
  enabled: true, ready: true, dbFile: 'x.db', rows: 1000, players: 2,
  from: 1000, to: 999_000_000, bytes: 65536, writes: 100, failures: 0,
  lastWriteAt: 999_000_000, lastError: null, lastErrorAt: null, recordAi: false,
  retention: { fullDays: 7, thinDays: 90 },
};

const PLAYERS = [
  { pid: 'p1', name: 'Walker', steamId: 'p1', samples: 500, firstTs: 1000, lastTs: 900_000 },
  { pid: 'p2', name: 'Camper', steamId: 'p2', samples: 500, firstTs: 1000, lastTs: 900_000 },
];

/** Route each /api/history/* call to a canned body. */
function mockApi(overrides: Record<string, unknown> = {}) {
  const areaCalls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const body = (() => {
      if (url.includes('/api/history/stats')) return overrides.stats ?? STATS_OK;
      if (url.includes('/api/history/players')) {
        return { available: true, items: overrides.players ?? PLAYERS };
      }
      if (url.includes('/api/history/track')) {
        return { available: true, items: overrides.tracks ?? [] };
      }
      if (url.includes('/api/history/area')) {
        areaCalls.push(url);
        return { available: true, items: overrides.visits ?? [] };
      }
      return {};
    })();
    return { ok: true, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, areaCalls };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(props: Partial<React.ComponentProps<typeof PlayerHistoryView>> = {}) {
  await act(async () => {
    root.render(
      <PlayerHistoryView
        onClose={() => {}}
        missionName="dayzoffline.chernarusplus"
        isPanel
        {...props}
      />,
    );
  });
  // Let the hooks' promises settle.
  await act(async () => { await Promise.resolve(); });
}

const text = () => container.textContent || '';

/** A HistoryTrack shaped like the server's, for the view-level tests. */
function trackFixture(
  pid: string, name: string, points: [number, number, number][],
): HistoryTrack {
  return {
    pid, name, stride: 1, runs: 1, sampled: points.length, simplified: false,
    points: points.map(([ts, x, z]) => ({
      ts, x, y: 0, z, health: 100, blood: null, shock: null,
      energy: null, water: null, alive: true, hands: null, gap: false,
    })),
  };
}

async function clickPlayer(name: string) {
  const row = [...container.querySelectorAll('button')]
    .find(b => b.textContent?.includes(name))!;
  await act(async () => { row.click(); });
  await act(async () => { await Promise.resolve(); });
}

/** The colour dot inside a roster row. */
function rosterSwatch(name: string): HTMLElement | null {
  const row = [...container.querySelectorAll('button')]
    .find(b => b.textContent?.includes(name));
  return row?.querySelector<HTMLElement>('span.rounded-full') ?? null;
}

/** Hex and rgb() both appear depending on whether jsdom parsed a style attribute. */
function toRgb(c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return c.trim();
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('PlayerHistoryView', () => {
  it('renders the recorder status and roster when recording', async () => {
    mockApi();
    await render();
    expect(text()).toContain('Recording');
    expect(text()).toContain('Walker');
    expect(text()).toContain('Camper');
  });

  it('does not gate on CF Tools', async () => {
    // The whole point of this tool: every sample comes from the companion mod, so a
    // profile with no CF Tools binding must still get the full feature. If this ever
    // starts rendering a "not connected" state, the gate has crept back in.
    mockApi();
    await render({ selectedProfileId: undefined });
    expect(text()).not.toContain('CF Tools');
    expect(text()).toContain('Recording');
  });

  it('never asks CF Tools for anything', async () => {
    const { fetchMock } = mockApi();
    await render();
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/api/cftools'))).toBe(false);
    expect(urls.some(u => u.includes('/api/history/'))).toBe(true);
  });

  it('explains a disabled recorder rather than showing an empty map', async () => {
    mockApi({ stats: { ...STATS_OK, enabled: false, ready: false } });
    await render();
    expect(text()).toContain('History recording is disabled');
  });

  it('surfaces the underlying error when the store failed to open', async () => {
    // "Disabled" and "broken" have different fixes, so they must read differently.
    mockApi({
      stats: { ...STATS_OK, enabled: true, ready: false, lastError: 'EACCES: permission denied' },
    });
    await render();
    expect(text()).toContain('History recorder is unavailable');
    expect(text()).toContain('EACCES: permission denied');
  });

  it('requests a track when a player is selected', async () => {
    const { fetchMock } = mockApi();
    await render();
    const walker = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.includes('Walker'))!;
    await act(async () => { walker.click(); });
    await act(async () => { await Promise.resolve(); });

    const trackCalls = fetchMock.mock.calls
      .map(c => String(c[0]))
      .filter(u => u.includes('/api/history/track'));
    expect(trackCalls.length).toBeGreaterThan(0);
    expect(trackCalls[trackCalls.length - 1]).toContain('ids=p1');
  });

  it('switches to area mode and runs a query on drag release', async () => {
    const { areaCalls } = mockApi();
    await render();

    const areaBtn = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Area')!;
    await act(async () => { areaBtn.click(); });

    expect(text()).toContain('Drag on the map to select an area');

    const layer = container.querySelector('.cursor-crosshair')!;
    await act(async () => {
      pointer(layer, 'pointerdown', 300, 300);
      pointer(layer, 'pointermove', 340, 300);
      pointer(layer, 'pointerup', 340, 300);
    });
    await act(async () => { await Promise.resolve(); });

    // One query per completed drag, not one per pointermove.
    expect(areaCalls).toHaveLength(1);
    expect(areaCalls[0]).toMatch(/radius=\d+/);
  });

  it('gives a player the same colour on the map as in the roster', async () => {
    // The regression this pins: the roster coloured by selection order while the
    // paths coloured by position in `tracks`, which arrives sorted by pid and
    // filtered to whoever had samples. With one player those agree; with two they
    // diverge, and the swatch beside a name then belongs to somebody else's line.
    // Selecting p2 FIRST is what makes the two orderings disagree.
    mockApi({
      tracks: [
        trackFixture('p1', 'Walker', [[0, 100, 100], [5000, 200, 200]]),
        trackFixture('p2', 'Camper', [[0, 300, 300], [5000, 400, 400]]),
      ],
    });
    await render();

    await clickPlayer('Camper');
    await clickPlayer('Walker');

    const swatch = rosterSwatch('Camper')!;
    const line = [...container.querySelectorAll('polyline')]
      .find(el => el.closest('g')?.getAttribute('data-pid') === 'p2');

    expect(swatch.style.backgroundColor).not.toBe('');
    expect(toRgb(swatch.style.backgroundColor))
      .toBe(toRgb(line!.getAttribute('stroke')!));
  });

  it('caps the selection at the palette size', async () => {
    // Past the palette two players wear the same colour, and colour is the only
    // thing tying a marker to a name.
    const many = Array.from({ length: MAX_TRACKS + 2 }, (_, i) => ({
      pid: `q${i}`, name: `P${i}`, steamId: `q${i}`,
      samples: 10, firstTs: 1000, lastTs: 900_000,
    }));
    const { fetchMock } = mockApi({ players: many });
    await render();

    for (const p of many) await clickPlayer(p.name);

    const last = fetchMock.mock.calls.map(c => String(c[0]))
      .filter(u => u.includes('/api/history/track')).pop()!;
    const ids = new URL(last, 'http://x').searchParams.get('ids')!.split(',');
    expect(ids).toHaveLength(MAX_TRACKS);
    expect(text()).toContain(`${MAX_TRACKS} players maximum`);
  });

  it('names every replayed player on the map without hovering', async () => {
    // With four survivors moving at once, "who is that dot" cannot be a hover.
    mockApi({
      tracks: [
        trackFixture('p1', 'Walker', [[0, 100, 100], [5000, 200, 200]]),
        trackFixture('p2', 'Camper', [[0, 300, 300], [5000, 400, 400]]),
      ],
    });
    await render();
    await clickPlayer('Walker');
    await clickPlayer('Camper');

    const playbackBtn = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Playback')!;
    await act(async () => { playbackBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    const labels = [...container.querySelectorAll('div.pointer-events-none')]
      .map(el => el.textContent);
    expect(labels).toContain('Walker');
    expect(labels).toContain('Camper');
  });

  it('shows playback transport only in playback mode', async () => {
    mockApi();
    await render();
    expect(container.querySelector('input[type="range"]')).toBeNull();

    const playbackBtn = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Playback')!;
    await act(async () => { playbackBtn.click(); });

    expect(container.querySelector('input[type="range"]')).not.toBeNull();
    expect(text()).toContain('Select players to replay');
  });
});

describe('TrackLayer', () => {
  /** Points are [ts, x, z] or [ts, x, z, gap]. */
  const track = (pid: string, points: [number, number, number, boolean?][]): HistoryTrack => ({
    pid, name: pid, stride: 1, runs: 1, sampled: points.length, simplified: false,
    points: points.map(([ts, x, z, gap]) => ({
      ts, x, y: 0, z, health: 100, blood: null, shock: null,
      energy: null, water: null, alive: true, hands: null, gap: !!gap,
    })),
  });

  const renderLayer = async (tracks: HistoryTrack[], worldSize = 15360) => {
    await act(async () => {
      root.render(
        <TrackLayer
          tracks={tracks}
          worldSize={worldSize}
          colors={trackColors(tracks.map(t => t.pid))}
        />,
      );
    });
  };

  it('draws in world coordinates with the Z axis flipped', async () => {
    await renderLayer([track('a', [[0, 100, 200], [5000, 300, 400]])]);
    const poly = container.querySelector('polyline')!;
    // y = worldSize - z, so z=200 -> 15160 and z=400 -> 14960.
    expect(poly.getAttribute('points')).toBe('100.0,15160.0 300.0,14960.0');
  });

  it('opts the stroke out of the viewBox scale', async () => {
    // Without this the path renders as a wedge at high zoom, which is the whole
    // reason paths live inside the content box rather than on the marker overlay.
    await renderLayer([track('a', [[0, 0, 0], [5000, 10, 10]])]);
    expect(container.querySelector('polyline')!.getAttribute('vector-effect'))
      .toBe('non-scaling-stroke');
  });

  it('breaks the path at a flagged absence', async () => {
    // Joining across a six-hour absence would draw a journey that never happened.
    await renderLayer([track('a', [
      [0, 0, 0], [5000, 10, 0],
      [6 * 3600_000, 9000, 9000, true], [6 * 3600_000 + 5000, 9010, 9000],
    ])]);
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
  });

  it('does NOT break on a long interval that carries no absence flag', async () => {
    // The real-data regression: decimation legitimately puts an hour between two
    // points of one straight walk. Splitting there shatters the path into single
    // points, which then get dropped, and the map renders empty.
    await renderLayer([track('a', [[0, 0, 0], [3600_000, 3600, 0], [7200_000, 7200, 0]])]);
    const polys = container.querySelectorAll('polyline');
    expect(polys).toHaveLength(1);
    expect(polys[0].getAttribute('points')!.split(' ')).toHaveLength(3);
  });

  it('drops a run with only one point', async () => {
    // A single sample is a position, not a path; a one-point polyline draws nothing
    // but still costs a DOM node per orphaned sample.
    await renderLayer([track('a', [[0, 0, 0], [6 * 3600_000, 9000, 9000, true]])]);
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
  });

  it('renders nothing when there are no tracks', async () => {
    await renderLayer([]);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('dims tracks that are not highlighted', async () => {
    await act(async () => {
      root.render(
        <TrackLayer
          tracks={[track('a', [[0, 0, 0], [5000, 1, 1]]), track('b', [[0, 5, 5], [5000, 6, 6]])]}
          worldSize={15360}
          colors={trackColors(['a', 'b'])}
          highlighted={new Set(['a'])}
        />,
      );
    });
    const groups = [...container.querySelectorAll('g')];
    expect(groups[0].getAttribute('opacity')).toBe('1');
    expect(Number(groups[1].getAttribute('opacity'))).toBeLessThan(1);
  });
});
