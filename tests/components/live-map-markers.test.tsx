import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOX = 600;
// dayzoffline.chernarusplus in MAP_REGISTRY -> worldSize 15360.
const WORLD = 15360;

// Backend + CF Tools hooks are stubbed: this test exercises marker projection
// through the REAL useMapPanZoom/mapTransform stack, not the data plumbing.
vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  getApiBase: () => 'http://localhost:4317',
}));

vi.mock('@/hooks/useCfToolsStatus', () => ({
  useCfToolsStatus: () => ({
    status: {
      connected: true,
      nickname: 'Test Server',
      capabilities: { gsm: true, gameLabs: false },
    },
    reload: () => {},
  }),
}));

const PLAYER = {
  sessionId: 'sess-1',
  cftoolsId: 'cf-1',
  name: 'Alice',
  steamId: '76500000000000001',
  position: [3840, 10, 11520] as [number, number, number], // x = 1/4 world, z = 3/4 world
  ping: 40,
  loaded: true,
  banCount: 0,
};

const vehicle = (id: string, className: string) => ({
  id, className, displayName: null, position: [7680, 0, 7680] as [number, number, number], speed: 0, health: 1000,
});
const event = (id: string, className: string, type: string) => ({
  id, className, type, displayName: null, position: [7680, 0, 7680] as [number, number, number],
});

vi.mock('@/hooks/useLiveSnapshot', () => ({
  useLiveSnapshot: () => ({
    snapshot: {
      connected: true,
      players: { at: 1, stale: false, items: [PLAYER] },
      vehicles: {
        at: 1, stale: false,
        items: [
          vehicle('v1', 'VeeDub_Orange'),
          vehicle('v2', 'RFMosquito'),
          vehicle('v3', 'Boat_01_Camo'),
          vehicle('v4', 'Offroad_02'),
        ],
      },
      events: {
        at: 1, stale: false,
        items: [
          event('e1', 'Wreck_UH1Y', 'helicrash'),
          event('e2', 'Land_Wreck_hb01_aban1_police_DE', 'wreck'),
        ],
      },
      territories: { at: 1, stale: false, items: [] },
    },
    loading: false,
  }),
}));

vi.mock('@/contexts/CatalogContext', () => ({
  useCatalog: () => ({ displayNameFor: () => undefined }),
}));

import LiveMapView from '../../src/components/live/LiveMapView';

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

async function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <LiveMapView
        onClose={() => {}}
        selectedProfileId="p1"
        missionName="dayzoffline.chernarusplus"
        isPanel={true}
      />,
    );
  });
  return container;
}

describe('LiveMapView marker projection', () => {
  it('projects a player position through the shared map transform (Z inverted)', async () => {
    const container = await render();
    const marker = container.querySelector('button[title="Alice"]') as HTMLElement;
    expect(marker).toBeTruthy();

    // x = 3840/15360 of a 600px box = 150px; z = 11520/15360 -> screen Y is
    // inverted: (1 - 0.75) * 600 = 150px.
    expect(parseFloat(marker.style.left)).toBeCloseTo(150, 5);
    expect(parseFloat(marker.style.top)).toBeCloseTo(150, 5);
  });

  it('maps modded classnames to their Font Awesome glyphs', async () => {
    const container = await render();
    const iconIn = (title: string) =>
      (container.querySelector(`button[title="${title}"] svg`) as SVGElement | null)?.getAttribute('data-icon');

    expect(iconIn('VeeDub_Orange')).toBe('van-shuttle');
    expect(iconIn('RFMosquito')).toBe('helicopter-symbol');
    expect(iconIn('Boat_01_Camo')).toBe('ship');
    expect(iconIn('Offroad_02')).toBe('car');           // default vehicle
    expect(iconIn('Wreck_UH1Y')).toBe('helicopter');    // heli crash site
    expect(iconIn('Land_Wreck_hb01_aban1_police_DE')).toBe('car-burst'); // car wreck, not a helicrash
    expect(iconIn('Alice')).toBe('person');
  });

  it('shows the roster/summary side panel with the player count', async () => {
    const container = await render();
    expect(container.textContent).toContain('1 online');
    expect(container.textContent).toContain('Test Server');
  });
});
