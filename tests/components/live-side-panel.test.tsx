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
      // No label at all: the tooltip never reached us, so the cause is the payload
      // shape rather than the mod chain.
      {
        id: 't3', className: 'TerritoryFlag', type: 'territory_flag',
        displayName: null,
        position: [5000, 0, 6000] as [number, number, number],
      },
      // Sourced from the companion mod under BasicTerritories: no territory name, id
      // or level (that system has none), permissions instead of ranks, a member the
      // GUID ledger could not resolve, and object/cargo counts.
      {
        id: 'mod:7000_8000', className: 'TerritoryFlag', type: 'territory_flag',
        displayName: null, origin: 'mod',
        position: [7000, 0, 8000] as [number, number, number],
        territory: {
          name: null, flagLevel: 42, lifetimeHours: null,
          owner: { id: 'GUID-OWNER', name: 'PlayerOne', steamId: '76561198000000000', rank: null },
          territoryId: null, level: null,
          memberCount: 2,
          members: [
            {
              id: 'GUID-A', name: 'Bob', steamId: '76561198000000001', rank: null,
              permissions: 6, permissionNames: ['build', 'dismantle'], online: true,
            },
            {
              id: 'GUID-B', name: null, steamId: null, rank: null,
              permissions: null, permissionNames: [], online: false,
            },
          ],
          membersOmitted: 0,
          objectCount: 73, cargoCount: 412, radius: 150, scanAge: 30,
          membersTruncated: false, source: 'basic',
        },
      },
    ],
  },
  ai: {
    at: 1, stale: false,
    items: [
      {
        id: 'ai1', name: 'Mirek', className: 'eAI_SurvivorM_Mirek',
        faction: 'Raiders', group: 'Patrol-1', groupId: 7,
        position: [7500, 300, 2500] as [number, number, number],
        health: 88, blood: 5000, shock: 100, energy: null, water: null,
        alive: true, handItem: 'M4A1', handItemLabel: 'M4-A1', source: 'expansion',
      },
      // Identified by the mod's classname heuristic rather than the AI framework.
      {
        id: 'ai2', name: 'eAI_SurvivorF_Frida', className: 'eAI_SurvivorF_Frida',
        faction: null, group: null, groupId: null,
        position: [7600, 300, 2600] as [number, number, number],
        health: 100, blood: 5000, shock: 100, energy: null, water: null,
        alive: true, handItem: null, handItemLabel: null, source: 'heuristic',
      },
    ],
  },
} as unknown as LiveSnapshot;

const status = { connected: true, nickname: 'Test', capabilities: { gsm: true, gameLabs: true } };

async function render(selection: { kind: 'vehicle' | 'territory' | 'ai'; id: string } | null) {
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

  // A blank territory block is otherwise indistinguishable from "this flag has no
  // territory", and the two causes need completely different fixes.
  it('explains a labelled-but-unparsed flag as a mod-chain problem', async () => {
    const container = await render({ kind: 'territory', id: 't2' });
    const text = container.textContent || '';

    expect(text).toContain('still on GameLabs');
    expect(text).toContain('@spacecat_gamelabs_compat_expansion');
  });

  it('explains a flag with no label as a payload-shape problem', async () => {
    const container = await render({ kind: 'territory', id: 't3' });
    const text = container.textContent || '';

    expect(text).toContain('sent no label');
    expect(text).toContain('/api/cftools/raw/events');
    expect(text).not.toContain('@spacecat_gamelabs_compat_expansion');
  });

  it('leaves ordinary (non-territory) events without the territory hint', async () => {
    const container = await render({ kind: 'vehicle', id: 'v1' });
    expect(container.textContent || '').not.toContain('No territory detail');
  });
});

// BasicTerritories has no territory name/id/level and uses a permission bitmask rather
// than ranks, so a mod-sourced row exercises a different set of optional fields than
// the Expansion tooltip does.
describe('LiveSidePanel mod-sourced territory', () => {
  it('shows the object and cargo counts the mod scanned', async () => {
    const container = await render({ kind: 'territory', id: 'mod:7000_8000' });
    const text = container.textContent || '';

    expect(text).toContain('Objects');
    expect(text).toContain('73');
    expect(text).toContain('412 cargo');
  });

  it('renders decoded permission names where a system has no ranks', async () => {
    const container = await render({ kind: 'territory', id: 'mod:7000_8000' });
    const text = container.textContent || '';

    expect(text).toContain('Bob');
    expect(text).toContain('build, dismantle');
    // The raw mask is a fallback only; never shown when names are available.
    expect(text).not.toContain('#6');
  });

  // Both territory systems key members by BI GUID. When the mod's ledger has never
  // seen that account, the GUID is all we have — and it beats rendering "Unknown".
  it('falls back to the raw GUID for a member it could not resolve', async () => {
    const container = await render({ kind: 'territory', id: 'mod:7000_8000' });
    const text = container.textContent || '';

    expect(text).toContain('GUID-B');
    expect(text).not.toContain('Unknown');
  });

  it('omits the rows the territory system genuinely has no value for', async () => {
    const container = await render({ kind: 'territory', id: 'mod:7000_8000' });
    const text = container.textContent || '';

    // BasicTerritories declares no id or level, so these must not render as "-1" or "0".
    expect(text).not.toContain('Level');
    expect(text).not.toContain('-1');
    expect(text).not.toContain('Lifetime');
    // ...while the flag charge, which IS available, does render.
    expect(text).toContain('42%');
  });
});

describe('LiveSidePanel AI detail', () => {
  it('renders the AI stat block with faction and group', async () => {
    const container = await render({ kind: 'ai', id: 'ai1' });
    const text = container.textContent || '';

    expect(text).toContain('Mirek');
    expect(text).toContain('eAI_SurvivorM_Mirek');
    expect(text).toContain('Raiders');
    expect(text).toContain('Patrol-1');
    expect(text).toContain('88');
    expect(text).toContain('M4-A1');
  });

  // A heuristic match is close but not authoritative, so the panel says so rather
  // than implying the framework confirmed it.
  it('flags a heuristic identification and stays quiet on an exact one', async () => {
    const heuristic = await render({ kind: 'ai', id: 'ai2' });
    expect(heuristic.textContent || '').toContain('Identified by classname');

    const exact = await render({ kind: 'ai', id: 'ai1' });
    expect(exact.textContent || '').not.toContain('Identified by classname');
  });

  it('reports an AI that has left the snapshot rather than rendering a blank card', async () => {
    const container = await render({ kind: 'ai', id: 'gone' });
    expect(container.textContent || '').toContain('No longer reported.');
  });
});
