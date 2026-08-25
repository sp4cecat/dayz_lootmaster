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
      capabilities: { gsm: true, gameLabs: true },
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
  health: 87.4,
  handItem: 'M4A1',
  handItemLabel: null,
  blood: 4800,
  shock: 100,
  energy: 1200,
  water: 900,
  alive: true,
  ping: 40,
  loaded: true,
  banCount: 0,
};

// Per-test override for the players layer; null falls back to [PLAYER]. The
// snapshot mock factory reads this lazily, so tests can swap it before render().
let playersOverride: (typeof PLAYER)[] | null = null;

const at = (x: number, z: number) => [x, 0, z] as [number, number, number];
const vehicle = (id: string, className: string, position = at(7680, 7680)) => ({
  id, className, displayName: null, position, speed: 0, health: 1000,
});
const event = (id: string, className: string, type: string, position = at(7680, 7680)) => ({
  id, className, type, displayName: null, position,
});

vi.mock('@/hooks/useLiveSnapshot', () => ({
  useLiveSnapshot: () => ({
    snapshot: {
      connected: true,
      players: { at: 1, stale: false, items: playersOverride ?? [PLAYER] },
      vehicles: {
        at: 1, stale: false,
        items: [
          vehicle('v1', 'VeeDub_Orange', at(1000, 1000)),
          vehicle('v2', 'RFMosquito', at(1100, 1100)),
          vehicle('v3', 'Boat_01_Camo', at(1200, 1200)),
          vehicle('v4', 'Offroad_02', at(1300, 1300)),
          vehicle('v5', 'Expansion_Generic_Vehicle_Cover', at(1400, 1400)),
        ],
      },
      events: {
        at: 1, stale: false,
        items: [
          event('e1', 'Wreck_UH1Y', 'helicrash', at(2000, 2000)),
          event('e2', 'Land_Wreck_hb01_aban1_police_DE', 'wreck', at(2100, 2100)),
          event('e3', 'StaticObj_Wreck_Train_742_Red_DE', 'wreck', at(2200, 2200)),
          event('e4', 'KMUC Keycard', 'unknown', at(4000, 4000)), // loose on the ground
          event('e5', 'Staff', 'unknown', at(1000.5, 1000.5)),    // sits on a vehicle, but still world-placed
          event('e6', 'Camp Event', 'unknown', at(2300, 2300)),
          event('e7', 'Smokey Grenade', 'unknown', at(2400, 2400)),
          event('e8', 'Convoy', 'unknown', at(2500, 2500)),
          { ...event('e9', 'Mjolnir Head', 'unknown', at(2600, 2600)), moved: true }, // left its spawn point
          event('e10', 'Mjolnir Handle', 'unknown', at(3840, 11520)), // shares Alice's position
          event('e11', 'Submarine', 'unknown', at(2700, 2700)),
          event('e12', 'ExpansionAirdropContainer_Military', 'unknown', at(2800, 2800)),
          event('e13', 'Punch Card', 'unknown', at(2800, 2800)),  // shares the airdrop's position
          event('e14', 'ScientificBriefcase', 'unknown', at(2900, 2900)),
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

/** jsdom has no PointerEvent constructor; React 19 listens for the native type name. */
function pointer(el: Element, type: string, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'button', { value: 0 });
  el.dispatchEvent(e);
}

describe('LiveMapView marker projection', () => {
  it('projects a player position through the shared map transform (Z inverted)', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Alice"]') as HTMLElement;
    expect(marker).toBeTruthy();

    // x = 3840/15360 of a 600px box = 150px; z = 11520/15360 -> screen Y is
    // inverted: (1 - 0.75) * 600 = 150px.
    expect(parseFloat(marker.style.left)).toBeCloseTo(150, 5);
    expect(parseFloat(marker.style.top)).toBeCloseTo(150, 5);
  });

  it('renders players as a translucent orange dot with a hover tooltip (name, HP, hands)', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Alice"]') as HTMLElement;
    const dot = marker.querySelector('[data-testid="player-dot"]') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.className).toContain('bg-orange-500/60');
    expect(marker.querySelector('svg')).toBeNull(); // no glyph, no permanent name label

    expect(marker.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => {
      marker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = marker.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('Alice');
    expect(tip.textContent).toContain('HP: 87');
    expect(tip.textContent).toContain('Hands: M4A1');
  });

  it('prefers the catalog display name over the raw classname for hands', async () => {
    playersOverride = [{ ...PLAYER, handItemLabel: 'M4-A1' }];
    try {
      const container = await render();
      const marker = container.querySelector('button[aria-label="Alice"]') as HTMLElement;
      await act(async () => {
        marker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      const tip = marker.querySelector('[role="tooltip"]') as HTMLElement;
      expect(tip.textContent).toContain('Hands: M4-A1');
    } finally {
      playersOverride = null;
    }
  });

  it('drag-and-drop on a player dot opens the teleport confirmation at the drop point', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Alice"]') as HTMLElement;

    // Drag the dot from its marker (150,150) to the viewport centre (300,300).
    await act(async () => { pointer(marker, 'pointerdown', 150, 150); });
    await act(async () => { pointer(marker, 'pointermove', 300, 300); });
    // Mid-drag: ghost dot with the live destination coordinates.
    const ghost = container.querySelector('[data-testid="player-drag-ghost"]') as HTMLElement;
    expect(ghost).toBeTruthy();
    expect(ghost.textContent).toContain('7680, 7680');

    await act(async () => { pointer(marker, 'pointerup', 300, 300); });
    // (300,300) in a 600px box is the world centre; Z is screen-inverted.
    expect(document.body.textContent).toContain('Teleport player');
    expect(document.body.textContent).toContain('7680, 7680');
    // The click that follows a drag-release must not re-select the player.
    await act(async () => { marker.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).not.toContain('Ping');
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

    // Covered vehicles (Expansion cover entity) render silver.
    const covered = container.querySelector('button[title="Expansion_Generic_Vehicle_Cover"] svg');
    expect(covered?.getAttribute('data-icon')).toBe('car');
    expect(covered?.getAttribute('class')).toContain('text-slate-300');
  });

  it('maps modded event classnames to their Font Awesome glyphs', async () => {
    const container = await render();
    const iconIn = (title: string) =>
      (container.querySelector(`button[title="${title}"] svg`) as SVGElement | null)?.getAttribute('data-icon');

    expect(iconIn('StaticObj_Wreck_Train_742_Red_DE')).toBe('train'); // class match beats the wreck type
    expect(iconIn('KMUC Keycard')).toBe('credit-card');
    expect(iconIn('Staff')).toBe('staff-snake');        // bare 'staff' is FA Pro-only
    expect(iconIn('Camp Event')).toBe('campground');
    expect(iconIn('Smokey Grenade')).toBe('bomb');
    expect(iconIn('Convoy')).toBe('truck-field-un');
    expect(iconIn('Mjolnir Head')).toBe('gavel');
    expect(iconIn('Mjolnir Handle')).toBe('wand-magic'); // bare 'wand' is FA Pro-only
    expect(iconIn('Submarine')).toBe('star');
    expect(iconIn('ExpansionAirdropContainer_Military')).toBe('parachute-box');
    expect(iconIn('Punch Card')).toBe('ticket');
    expect(iconIn('ScientificBriefcase')).toBe('briefcase');
  });

  // Containment is decided upstream by spacecat_gamelabs, which simply does not
  // publish a marker for an item on a player or in cargo. So sharing a position
  // with a player/vehicle/container means nothing here — only the spawn ledger's
  // `moved` flag still greys a marker.
  it('greys only items the spawn ledger reports as moved, not co-located ones', async () => {
    const container = await render();
    const glyphClass = (title: string) =>
      (container.querySelector(`button[title="${title}"] svg`) as SVGElement | null)?.getAttribute('class') ?? '';

    expect(glyphClass('Mjolnir Head')).toContain('text-slate-300');       // moved from its spawn point

    // Co-location is no longer evidence of storage — these keep their own tints.
    expect(glyphClass('Punch Card')).not.toContain('text-slate-300');
    expect(glyphClass('Punch Card')).toContain('text-pink-400');
    expect(glyphClass('Staff')).not.toContain('text-slate-300');
    expect(glyphClass('Staff')).toContain('text-purple-400');
    expect(glyphClass('Mjolnir Handle')).not.toContain('text-slate-300');
    expect(glyphClass('Mjolnir Handle')).toContain('text-fuchsia-400');

    expect(glyphClass('KMUC Keycard')).not.toContain('text-slate-300');
    expect(glyphClass('KMUC Keycard')).toContain('text-violet-400');
    // Containers themselves never go silver.
    expect(glyphClass('ExpansionAirdropContainer_Military')).toContain('text-cyan-400');
    // Briefcase reads red for contrast against the pale map background.
    expect(glyphClass('ScientificBriefcase')).toContain('text-red-500');
  });

  it('shows the roster/summary side panel with the player count', async () => {
    const container = await render();
    expect(container.textContent).toContain('1 online');
    expect(container.textContent).toContain('Test Server');
  });
});
