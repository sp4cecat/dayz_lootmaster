import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { HierarchicalProperties } from '../../src/components/hierarchical/HierarchicalProperties';
import EditFormSpawnableTab from '../../src/components/EditFormSpawnableTab';
import { XMLNodeKind } from '../../src/types/xml';
import type { LoadoutNode } from '../../src/types/loadouts';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/CatalogContext', async () => {
  const actual = await vi.importActual<any>('@/contexts/CatalogContext');
  // Identity must be stable: consumers put these callbacks in effect deps, so returning a
  // fresh object per call would re-fire those effects forever.
  const stub = {
    connected: false,
    displayNameFor: () => '',
    getTypeDetail: async () => null,
    peekTypeDetail: () => null,
    getCompatibleAttachments: async () => [],
    getItemsForSlot: async () => [],
    slotVocabulary: [],
  };
  return { ...actual, useCatalog: () => stub };
});

vi.mock('@/utils/xml', async () => {
  const actual = await vi.importActual('@/utils/xml');
  return { ...actual, findSpawnableEntryForType: vi.fn() };
});

import { findSpawnableEntryForType } from '@/utils/xml';

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: () => {
      root.unmount();
      document.body.removeChild(container);
    },
  };
}

const buttonsByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.trim() === text);

describe('HierarchicalProperties damage editor scoping', () => {
  const node: LoadoutNode = {
    id: 'n1', type: 'item', name: 'AKM', chance: 1, attachments: [], cargo: [],
  };

  const renderPanel = (isRootNode: boolean) => mount(
    <HierarchicalProperties
      node={node}
      onUpdate={() => {}}
      onClose={() => {}}
      typeOptions={['AKM']}
      availableTemplates={[]}
      randomPresets={{ presets: [] }}
      spawnableTypesByGroup={{}}
      isRootNode={isRootNode}
      config={{ showQuantity: false, showDamage: true }}
    />
  );

  it('offers the damage editor for a root node', async () => {
    const { container, unmount } = await renderPanel(true);
    expect(container.textContent).toContain('Damage (Optional)');
    unmount();
  });

  // The serialiser only emits <damage> for the root type, so a value set on a cargo /
  // attachment child would be silently dropped. Hide the control rather than lie.
  it('hides the damage editor for a cargo / attachment child node', async () => {
    const { container, unmount } = await renderPanel(false);
    expect(container.textContent).not.toContain('Damage (Optional)');
    unmount();
  });
});

describe('EditFormSpawnableTab item condition persistence', () => {
  const baseProps = {
    selectedTypes: [{ name: 'TestItem', group: 'vanilla' }] as any,
    spawnableTypesByGroup: {},
    setSpawnableTypesByGroup: vi.fn(),
    randomPresets: { presets: [] },
    globalsDefaults: { LootDamageMin: 0.1, LootDamageMax: 0.8 },
    typeOptions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (findSpawnableEntryForType as any).mockReturnValue(null); // virtual entry, no damage yet
  });

  const damageSectionOf = (payload: any) =>
    payload['__root']['cfgspawnabletypes.xml'].types[0].sections
      .find((s: any) => s.kind === XMLNodeKind.DAMAGE);

  // Regression: treeItems is only reseeded when the edited type/file changes, so setting the
  // item condition must also sync the tree's root node. Otherwise the next tree edit
  // re-serialises <damage> from a stale root and silently reverts the value.
  it('keeps the item condition when a later tree edit re-serialises the entry', async () => {
    const setSpy = vi.fn();
    const { container, unmount } = await mount(
      <EditFormSpawnableTab {...baseProps} setSpawnableTypesByGroup={setSpy} />
    );

    // "Set Spawn Damage" runs the same handleDamageChange path as the condition sliders.
    const setDamage = buttonsByText(container, 'Set Spawn Damage')[0];
    expect(setDamage).toBeDefined();
    await act(async () => { setDamage.click(); });

    expect(damageSectionOf(setSpy.mock.calls.at(-1)![0])).toBeDefined();
    const callsAfterDamage = setSpy.mock.calls.length;

    // Now make any tree edit, which routes through commitTreeItems -> loadoutToSpawnableEntry.
    // Toggling the root's expander is the cheapest one: it calls onUpdate on the node.
    const expander = container.querySelector('button.mr-2') as HTMLButtonElement | null;
    expect(expander, 'expected the root node expander in the hierarchical tree').toBeTruthy();
    await act(async () => { expander!.click(); });

    expect(setSpy.mock.calls.length).toBeGreaterThan(callsAfterDamage);
    const damage = damageSectionOf(setSpy.mock.calls.at(-1)![0]);
    expect(damage, 'tree edit dropped the item condition').toBeDefined();
    expect(Number(damage.attrs.min)).toBeCloseTo(0.1, 3);
    expect(Number(damage.attrs.max)).toBeCloseTo(0.8, 3);

    unmount();
  });

  // Regression: SpawnableTypesManager saved entries as {name, sections} with no `damage` helper,
  // and that shape persists in IndexedDB. Gating the sliders on entry.damage showed the empty
  // state for a type that already had a <damage> section; clicking "Set Spawn Damage" then took
  // handleDamageChange's existing-section branch and overwrote min with the globals default.
  it('shows the condition sliders for an entry saved without the damage helper field', async () => {
    (findSpawnableEntryForType as any).mockReturnValue({
      group: '__root',
      file: 'cfgspawnabletypes.xml',
      entry: {
        name: 'TestItem',
        sections: [{ kind: XMLNodeKind.DAMAGE, chance: null, preset: '', attrs: { min: '0.250', max: '0.750' }, items: [] }],
      },
    });

    const { container, unmount } = await mount(<EditFormSpawnableTab {...baseProps} />);

    expect(buttonsByText(container, 'Set Spawn Damage')).toHaveLength(0);
    expect(container.textContent).toContain('Min Damage');
    expect(container.textContent).toContain('Max Damage');

    unmount();
  });
});
