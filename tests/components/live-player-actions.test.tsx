import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  getApiBase: () => 'http://localhost:4317',
}));

vi.mock('@/contexts/CatalogContext', () => ({
  useCatalog: () => ({ displayNameFor: () => undefined }),
}));

import PlayerActionsBar, { flattenLoadoutItems } from '../../src/components/live/PlayerActionsBar';

const PLAYER = {
  sessionId: 'sess-1',
  cftoolsId: 'cf-1',
  name: 'Alice',
  steamId: '76500000000000001',
  position: [100, 0, 200] as [number, number, number],
  ping: 40,
  loaded: true,
  banCount: 0,
};

function makeActions() {
  return {
    busy: false,
    error: null,
    clearError: vi.fn(),
    kick: vi.fn(async () => ({ ok: true })),
    message: vi.fn(async () => ({ ok: true })),
    raw: vi.fn(async () => ({ ok: true })),
    teleport: vi.fn(async () => ({ ok: true })),
    heal: vi.fn(async () => ({ ok: true })),
    kill: vi.fn(async () => ({ ok: true })),
    spawnItem: vi.fn(async () => ({ ok: true })),
    spawnLoadout: vi.fn(async () => ({ ok: true, results: [] })),
    gameLabsAction: vi.fn(async () => ({ ok: true })),
  };
}

async function render(actions: ReturnType<typeof makeActions>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PlayerActionsBar
        player={PLAYER}
        actions={actions as never}
        selectedProfileId="p1"
        gameLabs={true}
        onStartTeleport={() => {}}
      />,
    );
  });
  return container;
}

const buttonByText = (container: HTMLElement | Document, text: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);

describe('flattenLoadoutItems', () => {
  it('collects item nodes across attachments and cargo, skipping groups/templates', () => {
    const items = flattenLoadoutItems([
      {
        type: 'item', name: 'M4A1',
        attachments: [
          { type: 'item', name: 'M4_Suppressor' },
          { type: 'group', name: '', attachments: [{ type: 'item', name: 'ACOGOptic' }] },
          { type: 'template', name: 'ar_mags' },
        ],
        cargo: [{ type: 'item', name: 'Mag_STANAG_30Rnd' }],
      },
      { type: 'item', name: 'TacticalBaconCan' },
    ]);
    expect(items).toEqual(['M4A1', 'M4_Suppressor', 'ACOGOptic', 'Mag_STANAG_30Rnd', 'TacticalBaconCan']);
  });

  it('handles empty/undefined trees', () => {
    expect(flattenLoadoutItems(undefined)).toEqual([]);
    expect(flattenLoadoutItems([])).toEqual([]);
  });
});

describe('PlayerActionsBar confirm gating', () => {
  it('does not kill until the destructive dialog is confirmed', async () => {
    const actions = makeActions();
    const container = await render(actions);

    await act(async () => { buttonByText(container, 'Kill')!.click(); });
    // Dialog open, nothing fired yet.
    expect(actions.kill).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Kill player');

    await act(async () => { buttonByText(document, 'Kill player')!.click(); });
    expect(actions.kill).toHaveBeenCalledWith(PLAYER.steamId);
  });

  it('cancelling the dialog fires nothing', async () => {
    const actions = makeActions();
    const container = await render(actions);

    await act(async () => { buttonByText(container, 'Kill')!.click(); });
    await act(async () => { buttonByText(document, 'Cancel')!.click(); });
    expect(actions.kill).not.toHaveBeenCalled();
  });

  it('heal is confirm-gated too', async () => {
    const actions = makeActions();
    const container = await render(actions);

    await act(async () => { buttonByText(container, 'Heal')!.click(); });
    expect(actions.heal).not.toHaveBeenCalled();
    // The confirm button inside the dialog is labelled "Heal" as well — pick
    // the one inside the modal footer (the last match).
    const confirms = [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Heal');
    await act(async () => { confirms[confirms.length - 1].click(); });
    expect(actions.heal).toHaveBeenCalledWith(PLAYER.steamId);
  });
});
