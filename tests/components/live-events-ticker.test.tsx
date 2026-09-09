import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { LivePlayer } from '../../src/types/cftools';
import type { HistoryAction } from '../../src/types/history';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
const NOW = 1_700_000_010_000;

const row = (over: Partial<HistoryAction>): HistoryAction => ({
  id: 1, ts: NOW - 60_000, pid: null, name: null, kind: 'death', cls: null,
  x: 1, y: 0, z: 1, detail: null, iid: null, fresh: null, held: null, dropped: null,
  ...over,
});

const DEFAULT_ROWS: HistoryAction[] = [
  row({ id: 1, ts: NOW - 600_000, pid: '76500000000000002', name: 'Bob', kind: 'connect' }),
  row({ id: 2, ts: NOW - 120_000, pid: '76500000000000009', name: 'Ghost', kind: 'death', detail: 'killer=76500000000000002' }),
];

// What the mocked backend returns; a test swaps it before rendering. Read lazily
// inside the mock, the same way `calls` is, so the hoisted factory never sees it.
let rows: HistoryAction[] = DEFAULT_ROWS;

vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async (path: string) => {
    calls.push(path);
    if (path.startsWith('/api/history/actions')) {
      return {
        ok: true,
        json: async () => ({
          available: true, truncated: false,
          kinds: [{ kind: 'death', count: 1 }, { kind: 'connect', count: 1 }],
          items: rows,
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  }),
  getApiBase: () => 'http://localhost:4317',
}));

import LiveEventsTicker from '../../src/components/live/LiveEventsTicker';

const bob: LivePlayer = {
  sessionId: 's-b', cftoolsId: null, name: 'Bob', steamId: '76500000000000002',
  position: [1, 0, 1], health: null, handItem: null, handItemLabel: null,
  blood: null, shock: null, energy: null, water: null, alive: true, ping: null, loaded: true, banCount: null,
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const selected: string[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls.length = 0;
  selected.length = 0;
  rows = DEFAULT_ROWS;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props: Partial<React.ComponentProps<typeof LiveEventsTicker>> = {}) {
  await act(async () => {
    root.render(
      <LiveEventsTicker
        now={NOW}
        enabled
        historyReason={null}
        players={[bob]}
        onSelectPlayer={(id) => selected.push(id)}
        {...props}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const tickerRows = () => [...container.querySelectorAll('[data-testid="ticker-row"]')];

/** The `kinds` the ticker asked for, as a list; the hook sorts and comma-joins them. */
function requestedKinds(): string[] {
  const q = calls.find(c => c.startsWith('/api/history/actions'))!;
  return (new URLSearchParams(q.slice(q.indexOf('?'))).get('kinds') ?? '').split(',');
}

describe('LiveEventsTicker', () => {
  it('asks for the last 15 minutes server-wide, newest first, with kind labels', async () => {
    await render();
    const q = calls.find(c => c.startsWith('/api/history/actions'))!;
    expect(q).toContain(`from=${NOW - 15 * 60_000}`);
    expect(q).toContain('kinds=');
    expect(q).not.toContain('ids=');
    expect(tickerRows().map(r => r.textContent)).toEqual([
      expect.stringContaining('Ghost · died'),
      expect.stringContaining('Bob · connected'),
    ]);
  });

  it('asks for kills but not for hits or damage taken', async () => {
    // A firefight is dozens of hits a minute; a 15-minute list would be nothing else.
    await render();
    const kinds = requestedKinds();
    expect(kinds).toContain('kill');
    expect(kinds).toContain('death');
    expect(kinds).not.toContain('hit');
    expect(kinds).not.toContain('damaged');
  });

  it('names the killer on a death when they are online, and falls back to the id', async () => {
    rows = [
      row({ id: 1, ts: NOW - 120_000, pid: '76500000000000009', name: 'Ghost', kind: 'death', detail: 'killer=76500000000000002' }),
      row({ id: 2, ts: NOW - 60_000, pid: '76500000000000008', name: 'Wraith', kind: 'death', detail: 'killer=76500000000000077' }),
    ];
    await render();
    const [wraith, ghost] = tickerRows().map(r => r.textContent);
    expect(ghost).toContain('by Bob');
    expect(wraith).toContain('by 76500000000000077');
  });

  it('selects the player when the row belongs to someone online', async () => {
    await render();
    const r = tickerRows();
    // Ghost is not online: an inert row, not a button.
    expect(r[0].tagName).toBe('DIV');
    expect(r[1].tagName).toBe('BUTTON');
    await act(async () => { (r[1] as HTMLButtonElement).click(); });
    expect(selected).toEqual(['s-b']);
  });

  it('shows who a kill was of: the online name, the offline id, or the creature', async () => {
    rows = [
      row({ id: 1, ts: NOW - 180_000, pid: '76500000000000009', name: 'Ghost', kind: 'kill', cls: 'SurvivorM_Boris',
        detail: 'victim=player:76500000000000002;zone=Head;dmg=110;ammo=Bullet_308Win;with=CZ550;dist=212.4;at=1,2,3' }),
      row({ id: 2, ts: NOW - 120_000, pid: '76500000000000009', name: 'Ghost', kind: 'kill', cls: 'SurvivorM_Boris',
        detail: 'victim=player:76500000000000077;zone=Torso;dmg=90;ammo=Bullet_308Win;with=CZ550;dist=80;at=1,2,3' }),
      row({ id: 3, ts: NOW - 60_000, pid: '76500000000000009', name: 'Ghost', kind: 'kill', cls: 'ZmbM_HermitSkinny_Base',
        detail: 'victim=infected;zone=Head;dmg=50;ammo=MeleeFist;with=;dist=1;at=1,2,3' }),
    ];
    await render();
    const [infected, offline, online] = tickerRows().map(r => r.textContent);
    expect(online).toContain('Ghost · killed');
    expect(online).toContain('· Bob');
    expect(offline).toContain('· 76500000000000077');
    expect(infected).toContain('· infected');
    // The rest of the detail belongs in the history feed, not a glance list.
    expect(infected).not.toContain('dmg');
  });

  it('issues no request and explains itself when history is off', async () => {
    await render({ enabled: false, historyReason: 'disabled' });
    expect(calls.filter(c => c.startsWith('/api/history'))).toEqual([]);
    expect(container.textContent).toContain('HISTORY_ENABLED=1');
  });
});
