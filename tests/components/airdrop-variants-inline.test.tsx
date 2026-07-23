import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { HierarchicalTree } from '../../src/components/hierarchical/HierarchicalTree';
import type { ChildListConfig } from '../../src/components/hierarchical/HierarchicalNodeItem';
import type { LoadoutNode } from '../../src/types/loadouts';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

// The tree pulls display names + item capabilities from the catalog; stub the whole module so
// it renders in isolation. null capabilities => lists are offered (acceptsAttachments !== false).
vi.mock('@/contexts/CatalogContext', () => ({
  useCatalog: () => ({ displayNameFor: () => '' }),
  useItemCapabilities: () => ({ acceptsAttachments: null, holdsCargo: null }),
  useAttachmentSlots: () => null,
}));

// Mirrors AIRDROP_CHILD_LISTS: a Contents list + the inline Variants list.
const CHILD_LISTS: ChildListConfig[] = [
  { key: 'attachments', label: 'Contents', icon: () => null, gate: 'either' },
  { key: 'variants', label: 'Variants', icon: () => null },
];

const rootWithAttachment = (): LoadoutNode => ({
  id: 'root',
  type: 'item',
  name: 'AKM',
  chance: 1,
  isExpanded: true,
  attachments: [{ id: 'att', type: 'item', name: 'AKM_Suppressor', chance: 1, attachments: [], cargo: [] }],
  cargo: [],
});

async function render(items: LoadoutNode[], onUpdate: (items: LoadoutNode[]) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HierarchicalTree
        items={items}
        childLists={CHILD_LISTS}
        onUpdate={onUpdate}
        onSelect={() => {}}
        onAddTemplate={() => {}}
        selectedNodeId={null}
      />,
    );
  });
  return { container, cleanup: () => { root.unmount(); document.body.removeChild(container); } };
}

const btnByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(b => (b.textContent || '').includes(text));

describe('Inline airdrop variants (tree)', () => {
  it('shows a Variants list on a root item', async () => {
    const { container, cleanup } = await render([rootWithAttachment()], vi.fn());
    const text = container.textContent || '';
    expect(text).toContain('Variants');
    expect(text).toContain('Contents');
    expect(btnByText(container, 'Clone from item')).toBeTruthy();
    cleanup();
  });

  it('"Clone from item" seeds a variant carrying the item\'s Contents', async () => {
    const onUpdate = vi.fn();
    const { container, cleanup } = await render([rootWithAttachment()], onUpdate);
    await act(async () => { btnByText(container, 'Clone from item')!.click(); });

    const updatedItems = onUpdate.mock.calls[0][0] as LoadoutNode[];
    const variants = updatedItems[0].variants!;
    expect(variants).toHaveLength(1);
    expect(variants[0].name).toBe('AKM');
    // The seed is a fresh-id independent copy that carries the base item's attachments.
    expect(variants[0].id).not.toBe('root');
    expect(variants[0].attachments.map(a => a.name)).toEqual(['AKM_Suppressor']);
    cleanup();
  });

  it('does not nest a Variants list under a variant row (depth gate)', async () => {
    const root: LoadoutNode = {
      ...rootWithAttachment(),
      variants: [{ id: 'v1', type: 'item', name: 'M4A1', chance: 1, isExpanded: true, attachments: [], cargo: [] }],
    };
    const { container, cleanup } = await render([root], vi.fn());
    // Only the root's own Variants list header should appear — the variant row (an item) must
    // not render its own nested "Variants" list.
    const occurrences = (container.textContent || '').split('Variants').length - 1;
    expect(occurrences).toBe(1);
    cleanup();
  });
});
