import { describe, it, expect } from 'vitest';
import { validateTypeAgainstDefinitions, validateUnknowns } from '../../src/utils/validation.js';

describe('validation', () => {
  const defs = {
    categories: ['tools', 'food'],
    usageflags: ['Town', 'Village'],
    valueflags: ['Tier1', 'Tier2'],
    tags: ['dynamic', 'static']
  };

  it('validates type properties', () => {
    const t = {
      name: 'Test',
      category: 'tools',
      nominal: 1, min: 0, lifetime: 10, restock: 0, quantmin: -1, quantmax: -1,
      usage: ['Town'],
      value: ['Tier2'],
      tag: ['dynamic'],
      flags: { count_in_cargo: true, count_in_hoarder: false, count_in_map: true, count_in_player: true, crafted: false, deloot: false }
    };
    const res = validateTypeAgainstDefinitions(t, defs);
    expect(Object.keys(res)).toHaveLength(0);
  });

  it('detects unknowns', () => {
    const t = {
      name: 'Test',
      category: 'unknown',
      nominal: 1, min: 0, lifetime: 10, restock: 0, quantmin: -1, quantmax: -1,
      usage: ['UnknownUsage'],
      value: ['UnknownValue'],
      tag: ['UnknownTag'],
      flags: { count_in_cargo: true, count_in_hoarder: false, count_in_map: true, count_in_player: true, crafted: false, deloot: false }
    };
    const unknowns = validateUnknowns([t], defs);
    expect(unknowns.hasAny).toBe(true);
    expect(Array.from(unknowns.sets.usage)).toContain('UnknownUsage');
    expect(unknowns.byType['Test'].usage).toContain('UnknownUsage');
    expect(unknowns.byType['Test'].category).toEqual(['unknown']);
  });
});
