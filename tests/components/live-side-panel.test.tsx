import { describe, it, expect } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import LiveSidePanel from '../../src/components/live/LiveSidePanel';
import type { LiveSnapshot } from '../../src/types/cftools';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = {
  connected: true,
  players: { at: 1, stale: false, items: [] },
  vehicles: {
    at: 1, stale: false,
    items: [{
      id: 'v1', className: 'jmc_atv_Aqua', displayName: null,
      position: [6820, 0, 12104] as [number, number, number], speed: 0, health: 5000,
    }],
  },
  events: { at: 1, stale: false, items: [] },
  territories: {
    at: 1, stale: false,
    items: [
      {
        id: 't1', className: 'TerritoryFlag', type: 'territory_flag',
        displayName: 'Northwood',
        position: [1000, 0, 2000] as [number, number, number],
        territory: {
          name: 'Northwood',
          flagLevel: 87,
          lifetimeHours: 41,
          owner: { name: 'PlayerOne', steamId: '76561198000000000' },
          territoryId: 4,
          level: 2,
          memberCount: 12,
          members: [
            { name: 'PlayerTwo', steamId: '76561198000000001', rank: 'Moderator' },
            { name: null, steamId: '76561198000000002', rank: 'Member' },
          ],
          membersOmitted: 9,
        },
      },
      // Still on GameLabs' baseline marker — no parsed territory.
      {
        id: 't2', className: 'TerritoryFlag', type: 'territory_flag',
        displayName: 'Territory Flag',
        position: [3000, 0, 4000] as [number, number, number],
      },
    ],
  },
} as unknown as LiveSnapshot;

const status = { connected: true, nickname: 'Test', capabilities: { gsm: true, gameLabs: true } };

async function render(selection: { kind: 'vehicle' | 'territory'; id: string } | null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <LiveSidePanel
        snapshot={snapshot}
        status={status as never}
        selection={selection}
        onClearSelection={() => {}}
        footer={<div data-testid="gl-footer">GameLabs actions</div>}
      />,
    );
  });
  return container;
}

describe('LiveSidePanel footer', () => {
  it('keeps the footer visible when a marker is selected (regression: contextual actions hidden)', async () => {
    const container = await render({ kind: 'vehicle', id: 'v1' });
    expect(container.textContent).toContain('jmc_atv_Aqua'); // detail card is up
    expect(container.querySelector('[data-testid="gl-footer"]')).toBeTruthy();
  });

  it('shows the footer in the no-selection summary too', async () => {
    const container = await render(null);
    expect(container.querySelector('[data-testid="gl-footer"]')).toBeTruthy();
  });
});

describe('LiveSidePanel territory detail', () => {
  it('renders the parsed tooltip as structured rows, not markup', async () => {
    const container = await render({ kind: 'territory', id: 't1' });
    const text = container.textContent || '';

    expect(text).toContain('Northwood');
    expect(text).toContain('PlayerOne');
    expect(text).toContain('#4 · Level 2');
    expect(text).toContain('87%');
    expect(text).toContain('~41 h');
    // Expansion's own count, which includes the owner and ignores the display cap.
    expect(text).toContain('12');
    // No HTML leaked through from the tooltip.
    expect(text).not.toContain('<br/>');
    expect(text).not.toContain('&middot;');
  });

  it('lists the roster with ranks, UIDs on hover, and the capped remainder', async () => {
    const container = await render({ kind: 'territory', id: 't1' });
    const text = container.textContent || '';

    expect(text).toContain('PlayerTwo');
    expect(text).toContain('Moderator');
    // A member Expansion has no name for falls back to the bare UID.
    expect(text).toContain('76561198000000002');
    expect(text).toContain('and 9 more not shown');

    // Steam64s ride in title= so a long UID cannot crowd out the name.
    const owner = container.querySelector('[title="76561198000000000"]');
    expect(owner?.textContent).toBe('PlayerOne');
  });

  it('shows no territory rows for a flag still on the baseline marker', async () => {
    const container = await render({ kind: 'territory', id: 't2' });
    const text = container.textContent || '';

    expect(text).toContain('Territory Flag');
    expect(text).not.toContain('Flag level');
    expect(text).not.toContain('Owner');
  });
});
