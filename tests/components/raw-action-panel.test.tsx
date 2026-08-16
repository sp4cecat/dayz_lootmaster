import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const ACTIONS = [
  { actionCode: 'CFCloud_WorldTime', actionContext: 'world', actionName: 'Update world time', parameters: {} },
  { actionCode: 'CFCloud_WipeAI', actionContext: 'world', actionName: 'Clear all world AI', parameters: {} },
  { actionCode: 'CFCloud_VehicleExplode', actionContext: 'vehicle', actionName: 'Explode vehicle', parameters: {} },
  { actionCode: 'CFCloud_HealPlayer', actionContext: 'player', actionName: 'Replenish player vitals', parameters: {} },
];

vi.mock('@/utils/api', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, actions: ACTIONS }) })),
  getApiBase: () => 'http://localhost:4317',
}));

import RawActionPanel, { type RawActionTarget } from '../../src/components/live/RawActionPanel';

const actionsStub = {
  busy: false,
  error: null,
  gameLabsAction: vi.fn(async () => ({ ok: true })),
} as unknown as Parameters<typeof RawActionPanel>[0]['actions'];

async function render(target?: RawActionTarget) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<RawActionPanel actions={actionsStub} selectedProfileId="p1" target={target} />);
  });
  return container;
}

const optionLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('option')).map(o => o.textContent);

describe('RawActionPanel contextual filtering', () => {
  it('offers only world-context actions when nothing is selected', async () => {
    const container = await render();
    const labels = optionLabels(container);
    expect(labels).toContain('Update world time');
    expect(labels).toContain('Clear all world AI');
    expect(labels).not.toContain('Explode vehicle');
    expect(labels).not.toContain('Replenish player vitals');
    expect(container.textContent).toContain('World');
  });

  it('narrows to vehicle actions targeting the selected vehicle, no manual reference input', async () => {
    const container = await render({ context: 'vehicle', referenceKey: '_Vehicle<0x1>', label: 'VeeDub_Orange' });
    const labels = optionLabels(container);
    expect(labels).toContain('Explode vehicle');
    expect(labels).not.toContain('Update world time');
    expect(labels).not.toContain('Replenish player vitals');
    expect(container.textContent).toContain('vehicle: VeeDub_Orange');
    // Reference comes from the selection — no free-text reference field.
    expect(container.querySelector('input[placeholder="vehicle reference key"]')).toBeNull();
  });

  it('shows an empty-context note when the selection has no matching actions', async () => {
    const container = await render({ context: 'object', referenceKey: '_Event<0x2>', label: 'KMUC Keycard' });
    expect(container.textContent).toContain('No object-context actions available.');
    expect(container.querySelector('select')).toBeNull();
  });
});
