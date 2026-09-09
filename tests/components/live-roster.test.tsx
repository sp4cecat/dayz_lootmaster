import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import LiveRoster, { sortRoster } from '../../src/components/live/LiveRoster';
import { livePlayerId } from '../../src/components/live/LiveMarkers';
import type { LivePlayer } from '../../src/types/cftools';
import type { PlayerFlag } from '../../src/types/history';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const base: LivePlayer = {
  sessionId: null, cftoolsId: null, name: '', steamId: null,
  position: [100, 0, 100], health: null, handItem: null, handItemLabel: null,
  blood: null, shock: null, energy: null, water: null, alive: true,
  ping: null, loaded: true, banCount: null,
};

const alice: LivePlayer = { ...base, sessionId: 's-a', name: 'Alice', steamId: '76500000000000001', health: 87, ping: 40 };
const bob: LivePlayer = { ...base, sessionId: 's-b', name: 'bob', steamId: '76500000000000002', health: 20, ping: 120 };
// Still loading in: no position, not loaded, nothing known.
const carol: LivePlayer = { ...base, sessionId: 's-c', name: 'Carol', steamId: '76500000000000003', position: null, loaded: false };
const dave: LivePlayer = { ...base, sessionId: 's-d', name: 'Dave', steamId: '76500000000000004', health: 0, alive: false, ping: 60 };

const flag = (pid: string, severity: string, score: number): PlayerFlag => ({
  pid, name: null, kind: 'loot_cycle', score, severity, peak: score, rung: 0, episodes: 1,
  firstAt: 1, updatedAt: 1, clearedAt: null, evidence: null, state: null,
});

const flags = new Map<string, PlayerFlag>([
  [alice.steamId!, flag(alice.steamId!, 'high', 72)],
  [dave.steamId!, flag(dave.steamId!, 'low', 12)],
]);

const players = [dave, carol, bob, alice];

describe('sortRoster', () => {
  it('defaults to a case-insensitive name order', () => {
    expect(sortRoster(players, 'name', flags).map(p => p.name)).toEqual(['Alice', 'bob', 'Carol', 'Dave']);
  });

  it('puts the lowest health first and unknown health last', () => {
    expect(sortRoster(players, 'health', flags).map(p => p.name)).toEqual(['Dave', 'bob', 'Alice', 'Carol']);
  });

  it('puts the worst ping first and unknown ping last', () => {
    expect(sortRoster(players, 'ping', flags).map(p => p.name)).toEqual(['bob', 'Dave', 'Alice', 'Carol']);
  });

  it('ranks by flag severity, then score, with unflagged players last', () => {
    expect(sortRoster(players, 'flag', flags).map(p => p.name)).toEqual(['Alice', 'Dave', 'bob', 'Carol']);
  });
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const selected: string[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  selected.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props: Partial<React.ComponentProps<typeof LiveRoster>> = {}) {
  await act(async () => {
    root.render(
      <LiveRoster
        players={players}
        selectedId={null}
        onSelect={(id) => selected.push(id)}
        flags={flags}
        {...props}
      />,
    );
  });
}

const rowNames = () =>
  [...container.querySelectorAll('[data-testid="roster-row"] [data-testid="roster-name"]')].map(el => el.textContent);

const chip = (label: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement;

describe('LiveRoster', () => {
  it('lists everyone online with a count, sorted by name', async () => {
    await render();
    expect(container.querySelectorAll('[data-testid="roster-row"]').length).toBe(4);
    expect(rowNames()).toEqual(['Alice', 'bob', 'Carol', 'Dave']);
    expect(container.textContent).toContain('Online4');
  });

  it('selects the same id the map marker would use', async () => {
    await render();
    const row = [...container.querySelectorAll('[data-testid="roster-row"]')]
      .find(el => el.textContent?.includes('Alice')) as HTMLButtonElement;
    await act(async () => { row.click(); });
    expect(selected).toEqual([livePlayerId(alice)]);
  });

  it('marks the selected row', async () => {
    await render({ selectedId: livePlayerId(bob) });
    const row = [...container.querySelectorAll('[data-testid="roster-row"]')]
      .find(el => el.textContent?.includes('bob')) as HTMLButtonElement;
    expect(row.getAttribute('aria-pressed')).toBe('true');
  });

  it('re-sorts from the chips', async () => {
    await render();
    await act(async () => { chip('Health').click(); });
    expect(rowNames()).toEqual(['Dave', 'bob', 'Alice', 'Carol']);
    await act(async () => { chip('Flag').click(); });
    expect(rowNames()).toEqual(['Alice', 'Dave', 'bob', 'Carol']);
  });

  it('filters to flagged, dead and still-loading players', async () => {
    await render();
    await act(async () => { chip('Flagged').click(); });
    expect(rowNames()).toEqual(['Alice', 'Dave']);
    await act(async () => { chip('Flagged').click(); chip('Dead').click(); });
    expect(rowNames()).toEqual(['Dave']);
    await act(async () => { chip('Dead').click(); chip('Loading in').click(); });
    expect(rowNames()).toEqual(['Carol']);
    expect(container.textContent).toContain('1 / 4');
  });

  it('matches the text filter on name and steam64', async () => {
    await render();
    const input = container.querySelector('input[aria-label="Filter players"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '0000004');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rowNames()).toEqual(['Dave']);
  });

  it('draws a compact health bar only when the mod supplied a value, and a loading-in chip', async () => {
    await render();
    const rows = [...container.querySelectorAll('[data-testid="roster-row"]')];
    const aliceRow = rows.find(el => el.textContent?.includes('Alice'))!;
    const carolRow = rows.find(el => el.textContent?.includes('Carol'))!;
    const bar = aliceRow.querySelector('[data-testid="vital-bar"] > span') as HTMLElement;
    expect(bar.style.width).toBe('87%');
    expect(carolRow.querySelector('[data-testid="vital-bar"]')).toBeNull();
    expect(carolRow.textContent).toContain('loading in');
  });

  it('shows the flag severity chip beside a flagged player', async () => {
    await render();
    const aliceRow = [...container.querySelectorAll('[data-testid="roster-row"]')]
      .find(el => el.textContent?.includes('Alice'))!;
    expect(aliceRow.textContent).toContain('High');
  });

  it('dims on a stale layer and explains a failed one', async () => {
    await render({ stale: true });
    expect(container.querySelector('[data-testid="live-roster"]')?.className).toContain('opacity-75');
    expect(container.textContent).toContain('stale');
    await render({ players: [], layerError: 'rate_limited' });
    expect(container.textContent).toContain('Player list unavailable (rate_limited)');
  });

  it('says so when nobody is online', async () => {
    await render({ players: [] });
    expect(container.textContent).toContain('Nobody is online.');
  });
});
