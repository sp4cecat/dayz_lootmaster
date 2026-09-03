import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A deliberately NON-SQUARE viewport, following player-history-map.test.tsx.
 *
 * The content square is `min(w, h)` and clampTransform letterboxes it, so at 900x600 the
 * map sits 150px in from the left. A 600x600 box makes that offset exactly 0 and would hide
 * any confusion between viewport space (where the menu anchor lives) and overlay space
 * (where markers live) — which is the bug this whole feature is most likely to have.
 */
const BOX_W = 900;
const BOX_H = 600;
const SIZE = 600;
const LETTERBOX = (BOX_W - SIZE) / 2;   // 150
// dayzoffline.chernarusplus in MAP_REGISTRY -> worldSize 15360.
const WORLD = 15360;

/**
 * Airdrop missions the fake endpoint returns, or null for "the request fails".
 * Read lazily by the mock so a test can swap it before rendering.
 */
let missionsResponse: unknown[] | null = null;

vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/api/expansion/airdrop-missions') && missionsResponse) {
      return { ok: true, json: async () => missionsResponse };
    }
    return { ok: false, json: async () => ({}) };
  }),
  getApiBase: () => 'http://localhost:4317',
}));

/**
 * Per-test capabilities. The server-action menu items are gated on what the live
 * server advertises, so tests need to move this rather than assume a fixed server.
 * Read lazily by the mock, so a test can swap it before rendering.
 */
let capsOverride: Record<string, unknown> | null = null;

vi.mock('@/hooks/useCfToolsStatus', () => ({
  useCfToolsStatus: () => ({
    status: {
      connected: true,
      nickname: 'Test Server',
      capabilities: capsOverride ?? { gsm: true, gameLabs: true },
    },
    reload: () => {},
  }),
}));

/** Records what the map fired, so tests can assert nothing goes out unconfirmed. */
const fired: { route: string; args: unknown[] }[] = [];
const actionResult = { ok: true };

vi.mock('@/hooks/useCfToolsActions', () => {
  const record = (route: string) => (...args: unknown[]) => {
    fired.push({ route, args });
    return Promise.resolve(actionResult);
  };
  return {
    useCfToolsActions: () => ({
      busy: false,
      error: null,
      clearError: () => {},
      kick: record('kick'), message: record('message'), raw: record('raw'),
      teleport: record('teleport'), heal: record('heal'), kill: record('kill'),
      spawnItem: record('spawnItem'), spawnLoadout: record('spawnLoadout'),
      gameLabsAction: record('gameLabsAction'),
      teleportAll: record('teleportAll'), spawnItemWorld: record('spawnItemWorld'),
      spawnAi: record('spawnAi'), startAirdrop: record('startAirdrop'),
      spawnPile: record('spawnPile'), spawnPileFlat: record('spawnPileFlat'),
    }),
    default: () => ({}),
  };
});

const at = (x: number, z: number) => [x, 0, z] as [number, number, number];

const PLAYER = {
  sessionId: 'sess-1',
  cftoolsId: 'cf-1',
  name: 'Alice',
  steamId: '76500000000000001',
  position: at(3840, 11520),   // x = 1/4 world, z = 3/4 world
  health: 87.4,
  handItem: null,
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

/**
 * Per-test override for the players layer; null falls back to [PLAYER]. Read lazily by the
 * snapshot mock, so a test can swap it before rendering.
 */
let playersOverride: (typeof PLAYER)[] | null = null;

vi.mock('@/hooks/useLiveSnapshot', () => ({
  useLiveSnapshot: () => ({
    snapshot: {
      connected: true,
      players: { at: 1, stale: false, items: playersOverride ?? [PLAYER] },
      vehicles: { at: 1, stale: false, items: [] },
      events: { at: 1, stale: false, items: [] },
      territories: { at: 1, stale: false, items: [] },
      ai: { at: 1, stale: false, items: [] },
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
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => BOX_W });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => BOX_H });
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: BOX_W, bottom: BOX_H, width: BOX_W, height: BOX_H,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  playersOverride = null;
  capsOverride = null;
  missionsResponse = null;
  fired.length = 0;
  writeText = vi.fn(async () => {});
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

/**
 * Roots must be unmounted, not just detached. react-aria's popover installs document-level
 * dismiss listeners; leaving a previous test's tree mounted lets them swallow the pointer
 * gestures a later test dispatches on the map.
 */
const roots: { unmount: () => void }[] = [];

afterEach(() => {
  act(() => { roots.splice(0).forEach(r => r.unmount()); });
  document.body.innerHTML = '';
});

async function render(missionName = 'dayzoffline.chernarusplus', loadouts?: unknown[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <LiveMapView
        onClose={() => {}}
        selectedProfileId="p1"
        missionName={missionName}
        isPanel={true}
        loadouts={loadouts as never}
      />,
    );
  });
  return container;
}

/**
 * A zoomed-in Deer Isle, for the tests that need the map to be pannable at all.
 *
 * Chernarus' bundled image is 554px, so in a 600px box `computeMaxScale` correctly reports
 * no zoom and `clampTransform` refuses to pan — centring on anything is a no-op there.
 * Deer Isle's imagery is 8192px, and two zoom steps (1.5^2 = 2.25) put the content square at
 * 1350px, wider than the 900px viewport, so there is room to pan on both axes.
 */
const DEER_ISLE_WORLD = 16384;

async function renderZoomed() {
  // A single player at the middle of the world: centring on them lands inside the pannable
  // range on both axes, so the clamp isn't what the assertion ends up measuring.
  playersOverride = [{ ...PLAYER, position: at(DEER_ISLE_WORLD / 2, DEER_ISLE_WORLD / 2) }];
  const container = await render('empty.deerisle');
  const zoomIn = container.querySelector('button[title="Zoom in"]') as HTMLElement;
  if (!zoomIn) throw new Error('No zoom controls — the map reports no zoom headroom.');
  await act(async () => { zoomIn.click(); });
  await act(async () => { zoomIn.click(); });
  return container;
}

/** The viewport carries the pan/zoom handlers; the map image is inside it. */
const viewport = (c: Element) => c.querySelector('.cursor-grab, .cursor-crosshair') as HTMLElement;

/** jsdom has no PointerEvent constructor; React 19 listens for the native type name. */
function pointer(el: Element, type: string, clientX: number, clientY: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'button', { value: 0 });
  el.dispatchEvent(e);
}

/** A press and release with no travel — the gesture that counts as a map click. */
async function clickMap(container: Element, x: number, y: number) {
  const el = viewport(container);
  await act(async () => {
    pointer(el, 'pointerdown', x, y);
    pointer(el, 'pointerup', x, y);
  });
}

async function rightClick(el: Element, x: number, y: number) {
  const e = new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
  });
  await act(async () => { el.dispatchEvent(e); });
  return e;
}

/** Menu items portal out of the map, so they are found on the document, not the container. */
const menuItems = () =>
  [...document.querySelectorAll('[role="menuitem"]')].map(el => el.textContent?.trim() ?? '');

function menuItem(label: string) {
  const hit = [...document.querySelectorAll('[role="menuitem"]')]
    .find(el => el.textContent?.trim() === label);
  if (!hit) throw new Error(`No menu item "${label}". Have: ${menuItems().join(' | ')}`);
  return hit as HTMLElement;
}

/** react-aria's press handling in jsdom: a full mouse sequence, not just click(). */
async function press(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, detail: 1 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

// The viewport centre. Content x = 450 - 150 letterbox = 300 of 600 -> half the world.
const CENTRE_X = 450;
const CENTRE_Y = 300;
const CENTRE_WORLD = { x: WORLD / 2, z: WORLD / 2 };   // 7680, 7680

describe('LiveMapView right-click menu', () => {
  it('opens at the cursor and reports the world position under it', async () => {
    const container = await render();
    const event = await rightClick(viewport(container), CENTRE_X, CENTRE_Y);

    // The native browser menu must never appear over the map.
    expect(event.defaultPrevented).toBe(true);
    // Header is the position in DayZ's own x y z order, height in the middle.
    expect(document.body.textContent).toContain(`${CENTRE_WORLD.x} 0 ${CENTRE_WORLD.z}`);
    expect(menuItems()).toEqual([
      'Copy coordinates', 'Copy as <pos> XML', 'Measure from here', 'Drop pin', 'Centre here',
    ]);
  });

  it('accounts for the letterbox offset rather than treating client x as content x', async () => {
    const container = await render();
    // Right on the left edge of the map square in a 900px-wide box. Reading clientX as
    // content x would report 15360 * 150/600 = 3840 instead of 0.
    await rightClick(viewport(container), LETTERBOX, CENTRE_Y);
    expect(document.body.textContent).toContain('0 0 7680');
  });

  it('copies the cursor position in game order', async () => {
    const container = await render();
    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    await press(menuItem('Copy coordinates'));
    expect(writeText).toHaveBeenCalledWith('7680 0 7680');
  });

  it('copies a <pos> element in the cfgeventspawns shape', async () => {
    const container = await render();
    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    await press(menuItem('Copy as <pos> XML'));
    expect(writeText).toHaveBeenCalledWith('<pos x="7680.0" z="7680.0" a="0.0" />');
  });

  it('offers player-specific items when the right-click lands on a marker', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Alice"]') as HTMLElement;
    expect(marker).toBeTruthy();

    await rightClick(marker, 200, 200);

    expect(document.body.textContent).toContain('Player — Alice');
    const items = menuItems();
    expect(items).toContain('Follow');
    expect(items).toContain('Copy Steam64');
    expect(items).toContain('Copy its position');
    // The map items stay available underneath.
    expect(items).toContain('Drop pin');
  });

  it('copies the marker\'s own position, not the cursor\'s', async () => {
    const container = await render();
    const marker = container.querySelector('button[aria-label="Alice"]') as HTMLElement;
    // Deliberately right-click at coordinates that are NOT the player's position.
    await rightClick(marker, CENTRE_X, CENTRE_Y);
    await press(menuItem('Copy its position'));
    expect(writeText).toHaveBeenCalledWith('3840 0 11520');
  });

  it('does not offer Follow for a territory or event, which cannot move', async () => {
    const container = await render();
    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    expect(menuItems()).not.toContain('Follow');
  });

  it('drops a pin at the cursor, projected onto the marker overlay', async () => {
    const container = await render();
    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    await press(menuItem('Drop pin'));

    const pin = container.querySelector('[data-testid="map-pin"]') as HTMLElement;
    expect(pin).toBeTruthy();
    // Overlay space excludes the pan: half the world -> half the 600px square.
    expect(parseFloat(pin.style.left)).toBeCloseTo(300, 5);
    expect(parseFloat(pin.style.top)).toBeCloseTo(300, 5);
  });

  it('measures distance and bearing between the right-click and the next map click', async () => {
    const container = await render();
    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    await press(menuItem('Measure from here'));

    // Armed, but nothing is drawn until the second point lands.
    expect(container.textContent).toContain('Click a second point to measure');
    expect(container.querySelector('[data-testid="measure-readout"]')).toBeNull();

    // 60px east of centre. 60/600 of the world = 1536 m, due east.
    await clickMap(container, CENTRE_X + 60, CENTRE_Y);

    const readout = container.querySelector('[data-testid="measure-readout"]') as HTMLElement;
    expect(readout).toBeTruthy();
    expect(readout.textContent).toContain('1.54 km');
    expect(readout.textContent).toContain('90°');
    expect(readout.textContent).toContain('E');
  });

  it('offers to clear a measurement only once one exists', async () => {
    const container = await render();
    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    expect(menuItems()).not.toContain('Clear measurement');
    await press(menuItem('Measure from here'));
    await clickMap(container, CENTRE_X + 60, CENTRE_Y);

    await rightClick(viewport(container), CENTRE_X, CENTRE_Y);
    expect(menuItems()).toContain('Clear measurement');
    await press(menuItem('Clear measurement'));
    expect(container.querySelector('[data-testid="measure-readout"]')).toBeNull();
  });

  it('follows a player: pans the map so they sit under the viewport centre', async () => {
    const container = await renderZoomed();
    const marker = () => container.querySelector('button[aria-label="Alice"]') as HTMLElement;
    const overlay = () => marker().parentElement as HTMLElement;

    await rightClick(marker(), 200, 200);
    await press(menuItem('Follow'));

    // Overlay positions are pan-free, so following moves the map, not the marker: Alice's
    // own left/top are unchanged by the pan, and the overlay translate carries it.
    const [tx, ty] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(overlay().style.transform)!
      .slice(1).map(Number);
    expect(tx + parseFloat(marker().style.left)).toBeCloseTo(BOX_W / 2, 4);
    expect(ty + parseFloat(marker().style.top)).toBeCloseTo(BOX_H / 2, 4);

    await rightClick(marker(), 200, 200);
    expect(menuItems()).toContain('Stop following');
    expect(menuItems()).not.toContain('Follow');
  });

  it('does not fight a manual pan — dragging the map stops following', async () => {
    const container = await renderZoomed();
    const marker = () => container.querySelector('button[aria-label="Alice"]') as HTMLElement;

    await rightClick(marker(), 200, 200);
    await press(menuItem('Follow'));

    // A drag past CLICK_SLOP turns the gesture into a pan.
    const el = viewport(container);
    await act(async () => {
      pointer(el, 'pointerdown', 400, 300);
      pointer(el, 'pointermove', 460, 340);
      pointer(el, 'pointerup', 460, 340);
    });

    await rightClick(marker(), 200, 200);
    expect(menuItems()).toContain('Follow');
    expect(menuItems()).not.toContain('Stop following');
  });

  it('leaves the map transform alone — a right-click is not a pan or a selection', async () => {
    const container = await render();
    const before = (container.querySelector('[data-testid="player-dot"]')
      ?.closest('button') as HTMLElement).style.left;

    await rightClick(viewport(container), 700, 500);

    const after = (container.querySelector('[data-testid="player-dot"]')
      ?.closest('button') as HTMLElement).style.left;
    expect(after).toBe(before);
  });
});

/**
 * The server-side group. Every item here changes the live server, so the two
 * things worth proving are that an item never appears when the server cannot
 * perform it, and that nothing fires before its confirmation is accepted.
 */
describe('LiveMapView right-click server actions', () => {
  const ALL_ACTIONS = {
    gsm: true,
    gameLabs: true,
    worldActions: { spawnItem: true, spawnAi: true, airdrop: true, spawnPile: true },
  };

  const LOADOUTS = [
    {
      id: 'l1',
      label: 'Starter kit',
      updatedAt: 0,
      items: [{ id: 'n1', type: 'item', name: 'M4A1', chance: 1, attachments: [], cargo: [] }],
    },
  ];

  /** The player dot, as a right-click target. */
  const playerMarker = (c: Element) =>
    c.querySelector('button[aria-label="Alice"]') as HTMLElement;

  /** The dialog's action buttons are plain buttons in a modal footer, not menuitems. */
  const dialogButton = (label: string) =>
    [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label);

  it('offers nothing beyond teleport on a plain GameLabs server', async () => {
    capsOverride = { gsm: true, gameLabs: true };
    const container = await render();
    await rightClick(viewport(container), 400, 300);

    const items = menuItems();
    expect(items).not.toContain('Spawn AI here…');
    expect(items).not.toContain('Start airdrop here…');
    expect(items).not.toContain('Spawn loadout here…');
    // The client-only items are unaffected by any of this.
    expect(items).toContain('Copy coordinates');
  });

  it('hides every server action when GameLabs is absent', async () => {
    capsOverride = { gsm: true, gameLabs: false };
    const container = await render();
    await rightClick(viewport(container), 400, 300);

    const items = menuItems();
    for (const label of ['Spawn AI here…', 'Start airdrop here…', 'Spawn loadout here…']) {
      expect(items).not.toContain(label);
    }
    expect(items.some(i => i.startsWith('Teleport'))).toBe(false);
  });

  it('shows each action once its backing world action is advertised', async () => {
    capsOverride = ALL_ACTIONS;
    const container = await render('dayzoffline.chernarusplus', LOADOUTS);
    await rightClick(viewport(container), 400, 300);

    const items = menuItems();
    expect(items).toContain('Spawn AI here…');
    expect(items).toContain('Start airdrop here…');
    expect(items).toContain('Spawn loadout here…');
  });

  it('still offers the loadout pile on a stock server, via the flat fallback', async () => {
    // spawnPile false, spawnItem true: the nested action is missing, but
    // CFCloud_SpawnItemWorld can still put the items on the ground.
    capsOverride = {
      gsm: true, gameLabs: true,
      worldActions: { spawnItem: true, spawnAi: false, airdrop: false, spawnPile: false },
    };
    const container = await render('dayzoffline.chernarusplus', LOADOUTS);
    await rightClick(viewport(container), 400, 300);
    expect(menuItems()).toContain('Spawn loadout here…');
  });

  /**
   * Regression: the mission list arrives.
   *
   * The lazy fetch used to sit in an effect that listed its own `missionsLoading`
   * state as a dependency. Setting the flag re-ran the effect, and the re-run's
   * cleanup cancelled the request it had just started, so the response was thrown
   * away and the picker showed "Loading…" forever.
   */
  it('loads the mission list into the airdrop picker', async () => {
    capsOverride = ALL_ACTIONS;
    missionsResponse = [
      { file: 'Airdrop_Military.json', data: { MissionName: 'Military', Container: 'ExpansionAirdropContainer' } },
      { file: 'Airdrop_Broken.json', data: null, error: 'Unexpected token' },
    ];
    const container = await render();
    await rightClick(viewport(container), 400, 300);
    await press(menuItem('Start airdrop here…'));

    const dialog = document.body.textContent || '';
    expect(dialog).not.toContain('Loading…');
    expect(dialog).toContain('Military');
    // A mission the server could not parse is listed but not selectable.
    const broken = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.includes('Unexpected token'));
    expect(broken).toBeTruthy();
    expect((broken as HTMLButtonElement).disabled).toBe(true);
    // Nothing goes out just from opening the picker.
    expect(fired).toHaveLength(0);
  });

  it('retries the mission list after a failed load', async () => {
    capsOverride = ALL_ACTIONS;
    const container = await render();

    // First open: the endpoint is down, so the picker reports an empty list.
    await rightClick(viewport(container), 400, 300);
    await press(menuItem('Start airdrop here…'));
    expect(document.body.textContent).toContain('No airdrop missions configured');
    await press(dialogButton('Cancel') as HTMLElement);

    // Second open: the endpoint is back. A permanently-claimed guard would have
    // left the empty message in place.
    missionsResponse = [{ file: 'Airdrop_Military.json', data: { MissionName: 'Military' } }];
    await rightClick(viewport(container), 400, 300);
    await press(menuItem('Start airdrop here…'));
    expect(document.body.textContent).toContain('Military');
  });

  it('teleports the right-clicked player, and only after the confirmation', async () => {
    capsOverride = ALL_ACTIONS;
    const container = await render();
    await rightClick(playerMarker(container), 300, 300);

    expect(menuItems()).toContain('Teleport Alice here');
    await act(async () => { menuItem('Teleport Alice here').click(); });

    // Opening the dialog must not have sent anything yet.
    expect(fired).toHaveLength(0);

    await act(async () => { dialogButton('Teleport')?.click(); });
    expect(fired).toHaveLength(1);
    expect(fired[0].route).toBe('teleport');
    expect(fired[0].args[0]).toBe(PLAYER.steamId);
  });

  it('does not fire when the confirmation is cancelled', async () => {
    capsOverride = ALL_ACTIONS;
    const container = await render();
    await rightClick(playerMarker(container), 300, 300);
    await act(async () => { menuItem('Teleport Alice here').click(); });
    await act(async () => { dialogButton('Cancel')?.click(); });
    expect(fired).toHaveLength(0);
  });

  it('only offers teleport-all when more than one player can be targeted', async () => {
    capsOverride = ALL_ACTIONS;
    const one = await render();
    await rightClick(viewport(one), 400, 300);
    expect(menuItems().some(i => i.startsWith('Teleport all'))).toBe(false);
  });

  it('excludes players with no steam64 from the teleport-all count', async () => {
    capsOverride = ALL_ACTIONS;
    playersOverride = [
      PLAYER,
      { ...PLAYER, sessionId: 'sess-2', steamId: '76500000000000002', name: 'Bob' },
      // Still loading in — no steam64, so no action can target them.
      { ...PLAYER, sessionId: 'sess-3', steamId: null as unknown as string, name: 'Ghost' },
    ];
    const container = await render();
    await rightClick(viewport(container), 400, 300);
    expect(menuItems()).toContain('Teleport all 2 players here');
  });

  it('disables the loadout item when there are no loadouts to spawn', async () => {
    capsOverride = ALL_ACTIONS;
    const container = await render('dayzoffline.chernarusplus', []);
    await rightClick(viewport(container), 400, 300);

    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find(el => el.textContent?.trim() === 'Spawn loadout here…');
    expect(item?.getAttribute('aria-disabled')).toBe('true');
  });

  it('spawns the loadout at the clicked point, not at a marker', async () => {
    capsOverride = ALL_ACTIONS;
    const container = await render('dayzoffline.chernarusplus', LOADOUTS);
    // x = LETTERBOX is the left edge of the content square, i.e. world x 0.
    await rightClick(viewport(container), LETTERBOX, BOX_H);
    await act(async () => { menuItem('Spawn loadout here…').click(); });

    const option = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.includes('Starter kit'));
    await act(async () => { option?.click(); });
    // Choosing an option must not fire it either — the footer button is the gate.
    expect(fired).toHaveLength(0);

    await act(async () => { dialogButton('Spawn')?.click(); });
    expect(fired).toHaveLength(1);
    expect(fired[0].route).toBe('spawnPile');
    expect(fired[0].args[0]).toBe(0);
  });

  it('falls back to the flat spawn when the nested action is unavailable', async () => {
    capsOverride = {
      gsm: true, gameLabs: true,
      worldActions: { spawnItem: true, spawnAi: false, airdrop: false, spawnPile: false },
    };
    const container = await render('dayzoffline.chernarusplus', LOADOUTS);
    await rightClick(viewport(container), 400, 300);
    await act(async () => { menuItem('Spawn loadout here…').click(); });
    const option = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.includes('Starter kit'));
    await act(async () => { option?.click(); });
    await act(async () => { dialogButton('Spawn')?.click(); });

    expect(fired[0].route).toBe('spawnPileFlat');
  });
});
