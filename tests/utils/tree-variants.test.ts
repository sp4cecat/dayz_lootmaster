import { describe, it, expect } from 'vitest';
import { findNode, updateNodeInList, cloneNodeWithNewIds } from '../../src/utils/tree';
import type { LoadoutNode } from '../../src/types/loadouts';

// A root item whose alternatives live in `variants` (each a nested item node).
const tree = (): LoadoutNode[] => [
  {
    id: 'root',
    type: 'item',
    name: 'AKM',
    chance: 1,
    attachments: [],
    cargo: [],
    variants: [
      { id: 'v1', type: 'item', name: 'SKS', chance: 0.3, attachments: [], cargo: [] },
      { id: 'v2', type: 'item', name: 'M4A1', chance: 0.2, attachments: [], cargo: [] },
    ],
  },
];

describe('tree utils recurse into variants', () => {
  it('findNode locates a variant node (so it is selectable/editable via the panel)', () => {
    expect(findNode(tree(), 'v2')?.name).toBe('M4A1');
  });

  it('updateNodeInList replaces a variant node in place', () => {
    const updated = updateNodeInList(tree(), {
      id: 'v1', type: 'item', name: 'SKS_Camo', chance: 0.3, attachments: [], cargo: [],
    });
    expect(updated[0].variants![0].name).toBe('SKS_Camo');
    // Sibling variant untouched.
    expect(updated[0].variants![1].name).toBe('M4A1');
  });

  it('cloneNodeWithNewIds re-ids variant descendants (no shared ids)', () => {
    const clone = cloneNodeWithNewIds(tree()[0]);
    expect(clone.id).not.toBe('root');
    expect(clone.variants!.map((v) => v.id)).not.toContain('v1');
    expect(clone.variants!.map((v) => v.id)).not.toContain('v2');
    // Content preserved.
    expect(clone.variants!.map((v) => v.name)).toEqual(['SKS', 'M4A1']);
  });
});
