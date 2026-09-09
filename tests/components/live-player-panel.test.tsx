import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { LivePlayer } from '../../src/types/cftools';
import type { PlayerFlag } from '../../src/types/history';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

/** A step boundary of the quantised clock, so `to` is exactly this. */
const NOW = 1_700_000_010_000;
const PID = '76500000000000001';
const CONNECT_AT = NOW - 2 * 3600_000;

const calls: string[] = [];
/** Per-test switch: when false the connect lookup returns nothing and no connect kinds. */
let hasConnect = true;

vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async (path: string) => {
    calls.push(path);
    const ok = (body: unknown) => ({ ok: true, json: async () => body });
    if (path.startsWith('/api/history/actions')) {
      const url = new URL(path, 'http://x');
      if (url.searchParams.get('kinds') === 'connect') {
        return ok({
          available: true, truncated: false,
          // The kinds are window-wide, across every player: the mod still emits
          // connects even when this player has none inside the lookup.
          kinds: [{ kind: 'connect', count: 1 }, { kind: 'pickup', count: 4 }],
          items: hasConnect ? [{
            id: 1, ts: CONNECT_AT, pid: PID, name: 'Alice', kind: 'connect', cls: null,
            x: 100, y: 0, z: 100, detail: null, iid: null, fresh: null, held: null, dropped: null,
          }] : [],
        });
      }
      return ok({
        available: true, truncated: false,
        kinds: [{ kind: 'pickup', count: 1 }],
        items: [{
          id: 7, ts: NOW - 60_000, pid: PID, name: 'Alice', kind: 'pickup', cls: 'M4A1',
          x: 3800, y: 0, z: 11500, detail: null, iid: 5, fresh: true, held: null, dropped: null,
        }],
      });
    }
    if (path.startsWith('/api/history/track')) {
      return ok({
        available: true,
        items: [{
          pid: PID, name: 'Alice', stride: 1, runs: 1, sampled: 2, simplified: false,
          points: [
            { ts: NOW - 120_000, x: 3700, y: 0, z: 11400, health: 90, blood: null, shock: null, energy: null, water: null, alive: true, hands: null, gap: false },
            { ts: NOW - 60_000, x: 3840, y: 0, z: 11520, health: 87, blood: null, shock: null, energy: null, water: null, alive: true, hands: null, gap: false },
          ],
        }],
      });
    }
    if (path.startsWith('/api/history/inventory')) {
      return ok({ available: true, truncated: false, items: [] });
    }
    if (path.startsWith('/api/history/flags/')) {
      return ok({ available: true, flag: null, enforcement: [], ladder: [{ rung: 1, severity: 'high', action: 'notice', text: 'Stop it', auto: false }] });
    }
    if (path.startsWith('/api/cftools/player')) {
      return ok({ connected: true, player: { 'cf-1': { omega: { playtime: 3600, sessions: 2 }, game: { dayz: { kills: { players: 3 } } } } } });
    }
    return { ok: false, json: async () => ({}) };
  }),
  getApiBase: () => 'http://localhost:4317',
}));

vi.mock('@/hooks/useQuantisedNow', () => ({
  useQuantisedNow: () => NOW,
  default: () => NOW,
}));

import LivePlayerPanel from '../../src/components/live/LivePlayerPanel';
import { useSelectedPlayerHistory } from '../../src/hooks/useSelectedPlayerHistory';
import { useQuantisedNow } from '../../src/hooks/useQuantisedNow';

const base: LivePlayer = {
  sessionId: null, cftoolsId: null, name: '', steamId: null,
  position: null, health: null, handItem: null, handItemLabel: null,
  blood: null, shock: null, energy: null, water: null, alive: true,
  ping: null, loaded: true, banCount: null,
};
const alice: LivePlayer = {
  ...base, sessionId: 's-a', cftoolsId: 'cf-1', name: 'Alice', steamId: PID,
  position: [3840, 10, 11520], health: 87, blood: 4000, shock: 100, energy: 2500, water: 1000, ping: 40,
};
// 300 m due east — inside the nearby radius.
const bob: LivePlayer = { ...base, sessionId: 's-b', name: 'Bob', steamId: '765b', position: [4140, 0, 11520] };
// 2 km away — outside it.
const far: LivePlayer = { ...base, sessionId: 's-f', name: 'Far', steamId: '765f', position: [5840, 0, 11520] };

const FLAG: PlayerFlag = {
  pid: PID, name: 'Alice', kind: 'loot_cycle', score: 72, severity: 'high', peak: 72, rung: 0,
  episodes: 1, firstAt: 1, updatedAt: 1, clearedAt: null, state: null,
  evidence: {
    score: 72, severity: 'high', silent: null, factors: [], excuse: { multiplier: 1, reasons: [] },
    counts: { cycles: 3, pickups: 5, orphanDrops: 0, homeDrops: 0, stashDrops: 0, totalDrops: 3 },
    cycles: [],
  },
};

interface HarnessProps {
  player?: LivePlayer;
  flag?: PlayerFlag | null;
  historyAvailable?: boolean;
  historyReason?: string | null;
  modConnected?: boolean;
  following?: boolean;
}

const selected: string[] = [];
const toggles: number[] = [];

/** Drives the real hook so the connect lookup → window → feed chain is what is tested. */
function Harness({
  player = alice, flag = null, historyAvailable = true, historyReason = null, modConnected = true, following = false,
}: HarnessProps) {
  const now = useQuantisedNow();
  const hist = useSelectedPlayerHistory({ pid: player.steamId, now, enabled: historyAvailable });
  return (
    <LivePlayerPanel
      player={player}
      players={[alice, bob, far]}
      hist={hist}
      flag={flag}
      onFlagChanged={() => {}}
      historyAvailable={historyAvailable}
      historyReason={historyReason}
      modConnected={modConnected}
      following={following}
      onToggleFollow={() => toggles.push(1)}
      onSelectPlayer={(id) => selected.push(id)}
      onClear={() => {}}
      selectedProfileId="p1"
      playerActions={<div data-testid="actions-slot">actions</div>}
      footer={<div data-testid="gl-footer">GameLabs</div>}
    />
  );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls.length = 0;
  selected.length = 0;
  toggles.length = 0;
  hasConnect = true;
  window.location.hash = '';
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  // Two stages of fetches (lookup, then track + feed), each several microtask hops.
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

async function render(props: HarnessProps = {}) {
  await act(async () => { root.render(<Harness {...props} />); });
  await settle();
}

const tab = (label: string) =>
  [...container.querySelectorAll('[role="tab"]')].find(b => b.textContent === label) as HTMLButtonElement;

const button = (label: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement;

describe('LivePlayerPanel overview', () => {
  it('shows meters for supplied vitals, identity rows, neighbours, actions and the footer', async () => {
    await render();
    const meters = container.querySelector('[data-testid="vital-meters"]')!;
    expect(meters.querySelectorAll('[data-testid="vital-bar"]').length).toBe(5);
    expect(container.textContent).toContain(PID);
    expect(container.textContent).toContain('40 ms');
    const nearby = container.querySelector('[data-testid="nearby-players"]')!;
    expect(nearby.textContent).toContain('Bob');
    expect(nearby.textContent).toContain('300 m');
    expect(nearby.textContent).toContain('90° E');
    expect(nearby.textContent).not.toContain('Far');
    expect(container.querySelector('[data-testid="actions-slot"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gl-footer"]')).toBeTruthy();
  });

  it('selects a neighbour on click', async () => {
    await render();
    const bobBtn = [...container.querySelectorAll('[data-testid="nearby-players"] button')]
      .find(b => b.textContent?.includes('Bob')) as HTMLButtonElement;
    await act(async () => { bobBtn.click(); });
    expect(selected).toContain('s-b');
  });

  it('offers a Follow toggle that reflects and reports state', async () => {
    await render();
    expect(button('Follow')).toBeTruthy();
    await act(async () => { button('Follow').click(); });
    expect(toggles.length).toBe(1);
    await render({ following: true });
    expect(button('Following')).toBeTruthy();
  });

  it('disables Follow and explains the neighbours for a player with no position', async () => {
    await render({ player: { ...alice, position: null } });
    expect(button('Follow').disabled).toBe(true);
    expect(container.querySelector('[data-testid="nearby-players"]')?.textContent).toContain('No position yet');
  });

  it('only offers the Flag tab when the player is flagged', async () => {
    await render();
    expect(tab('Flag')).toBeUndefined();
    await render({ flag: FLAG });
    expect(tab('Flag')).toBeTruthy();
    expect(container.querySelector('[data-testid="loot-cycle-flag"]')?.textContent).toContain('High');
  });
});

describe('LivePlayerPanel activity', () => {
  it('starts the session at the newest connect and fetches the path and feed for that window', async () => {
    await render();
    await act(async () => { tab('Activity').click(); });
    await settle();
    const lookup = calls.find(c => c.includes('kinds=connect'))!;
    expect(lookup).toContain(`ids=${PID}`);
    // Exactly one track request, and on the session window — never a provisional
    // fallback fetch that the real answer then replaces.
    const tracks = calls.filter(c => c.startsWith('/api/history/track'));
    expect(tracks.length).toBe(1);
    const track = tracks[0];
    expect(track).toContain(`from=${CONNECT_AT}`);
    expect(track).toContain(`to=${NOW}`);
    expect(track).toContain('max=800');
    expect(container.querySelector('[data-testid="window-label"]')?.textContent).toContain('since');
    expect(container.querySelector('[data-testid="path-summary"]')?.textContent).toContain('2 points · 1 run');
    expect(container.textContent).toContain('M4A1');
    expect(container.textContent).toContain('Picked up');
  });

  it('falls back to the cap when the mod emits connects but none is in the lookup', async () => {
    hasConnect = false;
    await render();
    await act(async () => { tab('Activity').click(); });
    await settle();
    expect(container.querySelector('[data-testid="window-label"]')?.textContent).toContain('connected earlier');
    const track = calls.find(c => c.startsWith('/api/history/track'))!;
    expect(track).toContain(`from=${NOW - 6 * 3600_000}`);
  });

  it('switches the window from the presets', async () => {
    await render();
    await act(async () => { tab('Activity').click(); });
    await settle();
    await act(async () => { button('15m').click(); });
    await settle();
    const track = calls.filter(c => c.startsWith('/api/history/track')).pop()!;
    expect(track).toContain(`from=${NOW - 15 * 60_000}`);
    expect(container.querySelector('[data-testid="window-label"]')?.textContent).toContain('last 15m');
  });

  it('deep-links to the Player History tool with the same player and window', async () => {
    await render();
    await act(async () => { tab('Activity').click(); });
    await settle();
    await act(async () => { (container.querySelector('[data-testid="open-history"]') as HTMLButtonElement).click(); });
    expect(window.location.hash).toBe(`#/map-tools/player-history?pid=${PID}&from=${CONNECT_AT}&to=${NOW}`);
  });

  it('shows the history-off notice and fires no history request', async () => {
    await render({ historyAvailable: false, historyReason: 'disabled' });
    await act(async () => { tab('Activity').click(); });
    await settle();
    expect(container.textContent).toContain('HISTORY_ENABLED=1');
    expect(calls.filter(c => c.startsWith('/api/history'))).toEqual([]);
  });

  it('says so for a player CF Tools has no steam64 for', async () => {
    await render({ player: { ...alice, steamId: null } });
    await act(async () => { tab('Activity').click(); });
    expect(container.textContent).toContain('not reported a Steam64');
    expect(calls.filter(c => c.startsWith('/api/history'))).toEqual([]);
  });
});

describe('LivePlayerPanel other tabs', () => {
  it('mounts the loadout panel with Capture now gated on the mod', async () => {
    await render({ modConnected: false });
    await act(async () => { tab('Loadout').click(); });
    await settle();
    const capture = button('Capture now');
    expect(capture).toBeTruthy();
    expect(capture.disabled).toBe(true);
    expect(calls.some(c => c.startsWith('/api/history/inventory'))).toBe(true);
  });

  it('fetches CF Tools stats only once the Stats tab opens', async () => {
    await render();
    expect(calls.some(c => c.startsWith('/api/cftools/player'))).toBe(false);
    await act(async () => { tab('Stats').click(); });
    await settle();
    expect(calls.some(c => c.startsWith('/api/cftools/player?ref=cf-1'))).toBe(true);
    expect(container.textContent).toContain('Playtime');
    expect(container.textContent).toContain('1.0 h');
  });

  it('shows the flag evidence and its ladder on the Flag tab', async () => {
    await render({ flag: FLAG });
    await act(async () => { tab('Flag').click(); });
    await settle();
    expect(calls.some(c => c.startsWith(`/api/history/flags/${PID}`))).toBe(true);
    // The one unfired rung is offered as a button, with the evidence counts above it.
    expect(container.textContent).toContain('Send notice');
    expect(container.textContent).toContain('3 cycles');
  });
});
