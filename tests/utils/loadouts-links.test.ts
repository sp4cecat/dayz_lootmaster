import { describe, it, expect } from 'vitest';
import {
  buildNodeIndex,
  resolveLinkedNode,
  cloneNodeAsLink,
  unlinkNode,
  materializeLinkedClones,
} from '../../src/utils/tree.ts';
import { loadoutToVanillaXml, loadoutToExpansionAirdrop } from '../../src/utils/loadouts.ts';
import type { Loadout, LoadoutNode } from '../../src/types/loadouts.ts';

// A source item with a nested attachment, used across the linking tests.
function makeSource(): LoadoutNode {
  return {
    id: 'src',
    type: 'item',
    name: 'M4A1',
    chance: 1.0,
    quantity: { min: 1, max: 1, percent: -1 },
    attachments: [
      { id: 'src-att', type: 'item', name: 'M4_Suppressor', chance: 0.5, attachments: [], cargo: [] },
    ],
    cargo: [],
  };
}

describe('cloneNodeAsLink', () => {
  it('deep-copies with fresh ids and links to the source id', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);

    expect(clone.linkedTo).toBe('src');
    expect(clone.id).not.toBe(source.id);
    expect(clone.attachments[0].id).not.toBe(source.attachments[0].id);
    // Content is copied at creation time (stale fallback), independent of the source object.
    expect(clone.name).toBe('M4A1');
  });

  it('links a clone of a clone to the ORIGINAL source, never chaining', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);
    const cloneOfClone = cloneNodeAsLink(clone);

    expect(cloneOfClone.linkedTo).toBe('src');
  });
});

describe('resolveLinkedNode', () => {
  it('mirrors the source content while keeping the clone id/expand state', () => {
    const source = makeSource();
    const clone = { ...cloneNodeAsLink(source), isExpanded: true };
    const index = buildNodeIndex([source, clone]);

    const resolved = resolveLinkedNode(clone, index);

    expect(resolved.id).toBe(clone.id);        // own identity
    expect(resolved.isExpanded).toBe(true);    // own UI state
    expect(resolved.linkedTo).toBe('src');     // still marked linked
    expect(resolved.name).toBe('M4A1');        // mirrored from source
    expect(resolved.attachments.map(a => a.name)).toEqual(['M4_Suppressor']);
  });

  it('reflects live edits to the source (mutating the indexed source object)', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);
    const index = buildNodeIndex([source, clone]);

    source.name = 'AKM';
    source.attachments.push({ id: 'src-att2', type: 'item', name: 'AK_Bayonet', chance: 1, attachments: [], cargo: [] });

    const resolved = resolveLinkedNode(clone, index);
    expect(resolved.name).toBe('AKM');
    expect(resolved.attachments.map(a => a.name)).toEqual(['M4_Suppressor', 'AK_Bayonet']);
  });

  it('falls back to the stored snapshot when the source is missing', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);
    const index = buildNodeIndex([clone]); // source not present

    const resolved = resolveLinkedNode(clone, index);
    expect(resolved).toBe(clone); // unchanged; uses its own stored content
  });
});

describe('unlinkNode', () => {
  it('bakes the mirrored content in with fresh child ids and drops the link', () => {
    const source = makeSource();
    source.name = 'AKM'; // edit source after cloning
    const clone = cloneNodeAsLink(source);
    const index = buildNodeIndex([source, clone]);

    const unlinked = unlinkNode(clone, index);

    expect(unlinked.linkedTo).toBeUndefined();
    expect(unlinked.id).toBe(clone.id);           // keeps its own identity
    expect(unlinked.name).toBe('AKM');            // baked from the CURRENT source
    expect(unlinked.attachments[0].name).toBe('M4_Suppressor');
    expect(unlinked.attachments[0].id).not.toBe(source.attachments[0].id); // fresh ids
  });
});

describe('materializeLinkedClones (export)', () => {
  it('replaces linked clones with concrete resolved content and drops the link', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);
    const items = [source, clone];
    const index = buildNodeIndex(items);

    const materialized = materializeLinkedClones(items, index);

    const mClone = materialized[1];
    expect(mClone.linkedTo).toBeUndefined();
    expect(mClone.name).toBe('M4A1');
    expect(mClone.attachments.map(a => a.name)).toEqual(['M4_Suppressor']);
  });
});

describe('DayZ export materializes linked clones', () => {
  const loadoutWith = (items: LoadoutNode[]): Loadout => ({
    id: 'l1', label: 'L', items, updatedAt: 0,
  });

  it('vanilla XML emits the source content for a linked clone', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);
    const xml = loadoutToVanillaXml(loadoutWith([source, clone]), []);

    // Two <type name="M4A1"> roots — the original and the materialized linked clone.
    const roots = xml.match(/<type name="M4A1">/g) || [];
    expect(roots).toHaveLength(2);
    expect(xml.match(/M4_Suppressor/g) || []).toHaveLength(2);
    expect(xml).not.toContain('linkedTo');
  });

  it('Expansion airdrop emits the source content for a linked clone', () => {
    const source = makeSource();
    const clone = cloneNodeAsLink(source);
    const loot = loadoutToExpansionAirdrop(loadoutWith([source, clone]), []);

    expect(loot).toHaveLength(2);
    expect(loot.map((l: any) => l.Name)).toEqual(['M4A1', 'M4A1']);
    expect(loot[1].Attachments.map((a: any) => a.Name)).toEqual(['M4_Suppressor']);
  });
});
