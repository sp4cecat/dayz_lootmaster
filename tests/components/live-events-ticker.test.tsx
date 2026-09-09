import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { LivePlayer } from '../../src/types/cftools';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
const NOW = 1_700_000_010_000;

vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async (path: string) => {
    calls.push(path);
    if (path.startsWith('/api/history/actions')) {
      return {
        ok: true,
        json: async () => ({
          available: true, truncated: false,
          kinds: [{ kind: 'death', count: 1 }, { kind: 'connect', count: 1 }],
          items: [
            { id: 1, ts: NOW - 600_000, pid: '76500000000000002', name: 'Bob', kind: 'connect', cls: null, x: 1, y: 0, z: 1, detail: null, iid: null, fresh: null, held: null, dropped: null },
            { id: 2, ts: NOW - 120_000, pid: '76500000000000009', name: 'Ghost', kind: 'death', cls: null, x: 1, y: 0, z: 1, detail: 'killer=76500000000000002', iid: null, fresh: null, held: null, dropped: null },
          ],
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

describe('LiveEventsTicker', () => {
  it('asks for the last 15 minutes server-wide, newest first, with kind labels', async () => {
    await render();
    const q = calls.find(c => c.startsWith('/api/history/actions'))!;
    expect(q).toContain(`from=${NOW - 15 * 60_000}`);
    expect(q).toContain('kinds=');
    expect(q).not.toContain('ids=');
    const rows = [...container.querySelectorAll('[data-testid="ticker-row"]')];
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('Ghost · died'),
      expect.stringContaining('Bob · connected'),
    ]);
    expect(rows[0].textContent).toContain('by 76500000000000002');
  });

  it('selects the player when the row belongs to someone online', async () => {
    await render();
    const rows = [...container.querySelectorAll('[data-testid="ticker-row"]')];
    // Ghost is not online: an inert row, not a button.
    expect(rows[0].tagName).toBe('DIV');
    expect(rows[1].tagName).toBe('BUTTON');
    await act(async () => { (rows[1] as HTMLButtonElement).click(); });
    expect(selected).toEqual(['s-b']);
  });

  it('issues no request and explains itself when history is off', async () => {
    await render({ enabled: false, historyReason: 'disabled' });
    expect(calls.filter(c => c.startsWith('/api/history'))).toEqual([]);
    expect(container.textContent).toContain('HISTORY_ENABLED=1');
  });
});
