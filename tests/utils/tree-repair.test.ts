import { describe, it, expect } from 'vitest';
import { repairItemClassNames } from '../../src/utils/tree';
import type { LoadoutNode } from '../../src/types/loadouts';

// A repair fn mimicking sanitizeClassName for two known polluted names.
const repair = (n: string) =>
  ({ 'ReflexOptic Baraka Sights': 'ReflexOptic', 'M4A1 M4-A1': 'M4A1' } as Record<string, string>)[n] || n;

const node = (over: Partial<LoadoutNode>): LoadoutNode => ({
  id: over.id || 'x', type: 'item', name: '', chance: 1, ...over,
});

describe('repairItemClassNames', () => {
  it('repairs a polluted top-level item name', () => {
    const { nodes, changed } = repairItemClassNames([node({ name: 'ReflexOptic Baraka Sights' })], repair);
    expect(changed).toBe(true);
    expect(nodes[0].name).toBe('ReflexOptic');
  });

  it('recurses into attachments and cargo', () => {
    const tree = [node({
      id: 'root', name: 'M4A1 M4-A1',
      attachments: [node({ id: 'a', name: 'ReflexOptic Baraka Sights' })],
      cargo: [node({ id: 'c', name: 'ReflexOptic Baraka Sights' })],
    })];
    const { nodes, changed } = repairItemClassNames(tree, repair);
    expect(changed).toBe(true);
    expect(nodes[0].name).toBe('M4A1');
    expect(nodes[0].attachments![0].name).toBe('ReflexOptic');
    expect(nodes[0].cargo![0].name).toBe('ReflexOptic');
  });

  it('leaves template/group node names alone (they are not classnames)', () => {
    const tree = [
      node({ id: 't', type: 'template', name: 'My Preset Name' }),
      node({ id: 'g', type: 'group', name: 'Some Group Label' }),
    ];
    const { nodes, changed } = repairItemClassNames(tree, repair);
    expect(changed).toBe(false);
    expect(nodes).toBe(tree); // same reference when nothing changed
  });

  it('returns the same array reference when nothing is polluted', () => {
    const tree = [node({ name: 'ReflexOptic', attachments: [node({ id: 'a', name: 'Suppressor' })] })];
    const { nodes, changed } = repairItemClassNames(tree, repair);
    expect(changed).toBe(false);
    expect(nodes).toBe(tree);
  });

  it('preserves untouched child arrays (does not fabricate empty ones)', () => {
    const clean = node({ id: 'clean', name: 'ReflexOptic' }); // no attachments/cargo
    const { nodes } = repairItemClassNames(
      [node({ id: 'root', name: 'M4A1 M4-A1', attachments: [clean] })],
      repair
    );
    // root changed (name), but its clean child keeps undefined cargo rather than [].
    expect(nodes[0].attachments![0].cargo).toBeUndefined();
  });
});
