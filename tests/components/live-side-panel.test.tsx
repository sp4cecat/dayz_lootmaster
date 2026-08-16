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
  territories: { at: 1, stale: false, items: [] },
} as unknown as LiveSnapshot;

const status = { connected: true, nickname: 'Test', capabilities: { gsm: true, gameLabs: true } };

async function render(selection: { kind: 'vehicle'; id: string } | null) {
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
