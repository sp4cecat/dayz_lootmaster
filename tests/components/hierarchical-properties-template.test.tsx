import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { HierarchicalProperties } from '../../src/components/hierarchical/HierarchicalProperties';
import type { LoadoutNode, Loadout } from '../../src/types/loadouts';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

// The panel pulls display names from the catalog; stub it so we can render in isolation.
vi.mock('@/contexts/CatalogContext', () => ({
  useCatalog: () => ({ displayNameFor: () => '' }),
}));

const itemNode: LoadoutNode = {
  id: 'n1',
  type: 'item',
  name: 'AKM',
  chance: 1,
  attachments: [],
  cargo: [],
};

const templateNode: LoadoutNode = {
  id: 'n2',
  type: 'template',
  templateSource: 'loadout',
  name: '',
  chance: 1,
  attachments: [],
  cargo: [],
};

const savedLoadouts: Loadout[] = [
  { id: 'ld-1', label: 'Military Kit', items: [], updatedAt: 0 },
];

async function render(node: LoadoutNode, onUpdate: (n: LoadoutNode) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HierarchicalProperties
        node={node}
        onUpdate={onUpdate}
        onClose={() => {}}
        typeOptions={['AKM']}
        availableTemplates={savedLoadouts}
        randomPresets={{ presets: [] }}
        expansionAirdrops={null}
        spawnableTypesByGroup={{}}
      />
    );
  });
  return { container, root, cleanup: () => { root.unmount(); document.body.removeChild(container); } };
}

describe('HierarchicalProperties template source', () => {
  it('toggling an item to Template seeds templateSource and clears the stale classname', async () => {
    const onUpdate = vi.fn();
    const { container, cleanup } = await render(itemNode, onUpdate);

    const templateBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent === 'Template')!;
    await act(async () => { templateBtn.click(); });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'template', templateSource: 'loadout', name: '' })
    );
    cleanup();
  });

  it('renders the four source options and the target picker for a template node', async () => {
    const { container, cleanup } = await render(templateNode, vi.fn());

    const text = container.textContent || '';
    for (const label of ['Saved Loadout', 'Random Preset', 'Expansion Airdrop', 'Spawnable Type']) {
      expect(text).toContain(label);
    }
    // The loadout source picker should expose the saved loadout as a searchable target.
    expect(container.querySelector('[aria-label="Template source"]')).not.toBeNull();
    cleanup();
  });

  it('switching source resets the linked target name', async () => {
    const onUpdate = vi.fn();
    const linked: LoadoutNode = { ...templateNode, name: 'ld-1' };
    const { container, cleanup } = await render(linked, onUpdate);

    const presetBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent === 'Random Preset')!;
    await act(async () => { presetBtn.click(); });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ templateSource: 'preset', name: '' })
    );
    cleanup();
  });
});
