import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
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
const territory = (id: string, position: [number, number, number], radius: number | null = null) => ({
  ...event(id, 'TerritoryFlag', 'territory', position),
  displayName: id,
  territory: radius === null ? undefined : {
    name: id, radius,
    flagLevel: null, lifetimeHours: null, owner: null, territoryId: null, level: null,
    memberCount: null, members: [], membersOmitted: 0,
  },
});

// Per-test override for the territories layer; null falls back to [].
let territoriesOverride: ReturnType<typeof territory>[] | null = null;

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
          event('e6', 'Land_jmc_ce_oven', 'unknown', at(2300, 2300)),
          event('e7', 'Smokey Grenade', 'unknown', at(2400, 2400)),
          event('e8', 'Convoy', 'unknown', at(2500, 2500)),
          { ...event('e9', 'Mjolnir Head', 'unknown', at(2600, 2600)), moved: true }, // left its spawn point
          event('e10', 'Mjolnir Handle', 'unknown', at(3840, 11520)), // shares Alice's position
          event('e11', 'Land_STAG_Submarine_Dark', 'unknown', at(2700, 2700)),
          event('e12', 'ExpansionAirdropContainer_Military', 'unknown', at(2800, 2800)),
          event('e13', 'STAG_PunchedCard', 'unknown', at(2800, 2800)),  // shares the airdrop's position
          event('e14', 'ScientificBriefcase', 'unknown', at(2900, 2900)),
          event('e15', 'jmc_atv_STAG_Green', 'unknown', at(3000, 3000)),
        ],
      },
      territories: { at: 1, stale: false, items: territoriesOverride ?? [] },
      ai: {
        at: 1, stale: false,
        items: [{
          id: 'ai1', name: 'Mirek', className: 'eAI_SurvivorM_Mirek',
          faction: 'Raiders', group: 'Patrol-1', groupId: 7,
          position: at(3840, 11520), // same spot as Alice — AI must paint UNDER players
          health: 88, blood: 5000, shock: 100, energy: null, water: null,
          alive: true, handItem: 'M4A1', handItemLabel: 'M4-A1', source: 'expansion',
        }],
      },
    },
    loading: false,
  }),
}));

vi.mock('@/contexts/CatalogContext', () => ({
  useCatalog: () => ({ displayNameFor: () => undefined }),
}));

import LiveMapView from '../../src/components/live/LiveMapView';
import { territoryAtPoint } from '../../src/components/live/LiveMarkers';

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

/**
 * Which glyph a marker drew. lucide stamps its icon name onto the svg as a
 * `lucide-<name>` class (alongside the base `lucide` and our own tint classes),
 * so the first such class is the icon's identity.
 */
function iconIn(container: Element, title: string) {
  const cls = container.querySelector(`button[title="${title}"] svg`)?.getAttribute('class') ?? '';
  return /lucide-([a-z0-9-]+)/.exec(cls)?.[1];
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

  // The whole point of the colour split: an admin has to be able to tell a bot from a
  // person at a glance, without clicking either.
  it('renders Expansion AI as a green dot, distinct from the orange player dot', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Mirek"]') as HTMLElement;
    expect(marker).toBeTruthy();

    const dot = marker.querySelector('[data-testid="ai-dot"]') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.className).toContain('bg-green-500/60');
    expect(dot.className).not.toContain('bg-orange-500/60');
    expect(marker.querySelector('svg')).toBeNull(); // a dot, not a glyph — same as players
  });

  it('projects AI through the same transform as players and shows a hover tooltip', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Mirek"]') as HTMLElement;
    // Same world position as Alice, so it must land on the same pixel.
    expect(parseFloat(marker.style.left)).toBeCloseTo(150, 5);
    expect(parseFloat(marker.style.top)).toBeCloseTo(150, 5);

    await act(async () => {
      marker.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = marker.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tip.textContent).toContain('Mirek');
    expect(tip.textContent).toContain('Raiders');
    expect(tip.textContent).toContain('HP: 88');
    expect(tip.textContent).toContain('Hands: M4-A1');
  });

  // Drag-to-teleport resolves to a GameLabs player-context action keyed by steam64,
  // which an AI does not have. A grab cursor that silently no-ops would be worse than
  // no gesture at all.
  it('does not make AI draggable', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Mirek"]') as HTMLElement;
    expect(marker.className).not.toContain('cursor-grab');
    expect(marker.className).toContain('cursor-pointer');
  });

  // Paint order: AI sit under players, so a bot standing on a survivor never hides them.
  it('paints AI before players in DOM order', async () => {
    const container = await render();
    const dots = Array.from(container.querySelectorAll('[data-testid="ai-dot"], [data-testid="player-dot"]'));
    expect(dots.map(d => d.getAttribute('data-testid'))).toEqual(['ai-dot', 'player-dot']);
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

  it('maps modded classnames to their outline glyphs', async () => {
    const container = await render();

    expect(iconIn(container, 'VeeDub_Orange')).toBe('van');
    expect(iconIn(container, 'RFMosquito')).toBe('helicopter');
    expect(iconIn(container, 'Boat_01_Camo')).toBe('ship');
    expect(iconIn(container, 'Offroad_02')).toBe('car');    // default vehicle
    expect(iconIn(container, 'Wreck_UH1Y')).toBe('flame');  // heli crash site; the heli glyph is the flyable one
    expect(iconIn(container, 'Land_Wreck_hb01_aban1_police_DE')).toBe('car-front'); // car wreck, not a helicrash

    // Covered vehicles (Expansion cover entity) render silver.
    const covered = container.querySelector('button[title="Expansion_Generic_Vehicle_Cover"] svg');
    expect(iconIn(container, 'Expansion_Generic_Vehicle_Cover')).toBe('car');
    expect(covered?.getAttribute('class')).toContain('text-slate-300');
  });

  it('maps modded event classnames to their outline glyphs', async () => {
    const container = await render();

    expect(iconIn(container, 'StaticObj_Wreck_Train_742_Red_DE')).toBe('train-front'); // class match beats the wreck type
    expect(iconIn(container, 'KMUC Keycard')).toBe('credit-card');
    expect(iconIn(container, 'Staff')).toBe('wand');
    expect(iconIn(container, 'Land_jmc_ce_oven')).toBe('tent'); // camp event, no 'camp' in the name
    expect(iconIn(container, 'Smokey Grenade')).toBe('bomb');
    expect(iconIn(container, 'Convoy')).toBe('truck');
    expect(iconIn(container, 'Mjolnir Head')).toBe('gavel');
    expect(iconIn(container, 'Mjolnir Handle')).toBe('wand-sparkles'); // the plain wand is the Staff's
    expect(iconIn(container, 'Land_STAG_Submarine_Dark')).toBe('anchor');
    expect(iconIn(container, 'ExpansionAirdropContainer_Military')).toBe('package');
    expect(iconIn(container, 'STAG_PunchedCard')).toBe('ticket'); // 'PunchedCard', not 'Punch Card'
    expect(iconIn(container, 'ScientificBriefcase')).toBe('briefcase');
    expect(iconIn(container, 'jmc_atv_STAG_Green')).toBe('motorbike'); // ATV spawn event reads as a vehicle
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
    expect(glyphClass('STAG_PunchedCard')).not.toContain('text-slate-300');
    expect(glyphClass('STAG_PunchedCard')).toContain('text-pink-400');
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

describe('territory circle as a click target', () => {
  // 1280 m at worldSize 15360 over a 600 px box = a 50 px radius on screen, so the
  // circle is comfortably clickable while the 16 px flag glyph at its centre is not
  // what the test is aiming at.
  const RADIUS = 1280;
  const CENTRE = at(7680, 7680);          // screen (300, 300)
  const INSIDE = { x: 330, y: 300 };      // 768 m from the flag — on the circle, off the glyph
  const OUTSIDE = { x: 500, y: 500 };

  /** The circle div, whose border colour is how a territory reports being selected. */
  const circle = (c: Element) => c.querySelector('[data-testid="territory-circle"]');
  const isSelected = (c: Element) => !!circle(c)?.className.includes('border-primary-400/90');

  /** The viewport carries the pan/zoom handlers; the map image is inside it. */
  const viewport = (c: Element) => c.querySelector('.cursor-grab') as HTMLElement;

  const click = async (c: Element, x: number, y: number) => {
    const el = viewport(c);
    await act(async () => { pointer(el, 'pointerdown', x, y); });
    await act(async () => { pointer(el, 'pointerup', x, y); });
  };

  beforeEach(() => { territoriesOverride = [territory('Alpha', CENTRE, RADIUS)]; });
  afterEach(() => { territoriesOverride = null; });

  it('selects the territory when the circle is clicked away from the flag', async () => {
    const container = await render();
    expect(isSelected(container)).toBe(false);
    await click(container, INSIDE.x, INSIDE.y);
    expect(isSelected(container)).toBe(true);
  });

  it('clears the selection when the click lands outside every circle', async () => {
    const container = await render();
    await click(container, INSIDE.x, INSIDE.y);
    expect(isSelected(container)).toBe(true);
    await click(container, OUTSIDE.x, OUTSIDE.y);
    expect(isSelected(container)).toBe(false);
  });

  it('pans instead of selecting when the press inside a circle turns into a drag', async () => {
    // The reason this rides the background gesture rather than a hit area on the
    // circle: territory circles cover a lot of map, and a drag that starts on one
    // has to still be a pan.
    const container = await render();
    const el = viewport(container);
    await act(async () => { pointer(el, 'pointerdown', INSIDE.x, INSIDE.y); });
    await act(async () => { pointer(el, 'pointermove', INSIDE.x + 80, INSIDE.y); });
    await act(async () => { pointer(el, 'pointerup', INSIDE.x + 80, INSIDE.y); });
    expect(isSelected(container)).toBe(false);
  });

  it('leaves the circle inert while the territories layer is off', async () => {
    const container = await render();
    const toggle = container.querySelector('button[title="Territories"]') as HTMLElement;
    await act(async () => { toggle.click(); });
    await click(container, INSIDE.x, INSIDE.y);
    expect(circle(container)).toBeNull();
  });
});

describe('territoryAtPoint', () => {
  const t = (x: number, z: number, radius: number | null) =>
    territory('t', at(x, z), radius) as unknown as Parameters<typeof territoryAtPoint>[0][number];

  it('returns the containing circle and null outside every one', () => {
    const items = [t(1000, 1000, 100)];
    expect(territoryAtPoint(items, 60, 1050, 1000)).toBe(0);
    expect(territoryAtPoint(items, 60, 1000, 1099)).toBe(0);
    expect(territoryAtPoint(items, 60, 1101, 1000)).toBeNull();
    // Pythagoras, not a bounding box: the corner of the square is outside.
    expect(territoryAtPoint(items, 60, 1080, 1080)).toBeNull();
  });

  it('falls back to the server-wide radius when the flag reports none', () => {
    const items = [t(1000, 1000, null)];
    expect(territoryAtPoint(items, 60, 1050, 1000)).toBe(0);
    expect(territoryAtPoint(items, 60, 1070, 1000)).toBeNull();
  });

  it('prefers the smallest circle when territories nest', () => {
    // A compound inside a larger claim: the inner one is the specific answer.
    const items = [t(1000, 1000, 500), t(1000, 1000, 80)];
    expect(territoryAtPoint(items, 60, 1010, 1000)).toBe(1);
    // ...and the outer is still reachable from the ring the inner does not cover.
    expect(territoryAtPoint(items, 60, 1200, 1000)).toBe(0);
  });

  it('is null for an empty or absent list', () => {
    expect(territoryAtPoint([], 60, 0, 0)).toBeNull();
    expect(territoryAtPoint(undefined, 60, 0, 0)).toBeNull();
  });
});
