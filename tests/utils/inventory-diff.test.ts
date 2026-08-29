import { describe, it, expect } from 'vitest';
import { countItems, countNodes, diffInventories } from '../../src/utils/inventoryDiff';
import type { InventoryNode } from '../../src/types/history';

/**
 * The comparison behind the rollback confirmation.
 *
 * What it has to get right is the DESTROY side. A rollback replaces everything a
 * player is carrying, and an operator who is shown an empty "destroyed" list when
 * items would in fact be destroyed has been misled about the only irreversible
 * half of the action.
 */

const node = (cls: string, over: Partial<InventoryNode> = {}): InventoryNode => ({
    cls,
    slot: null,
    where: 'cargo',
    health01: 1,
    healthLevel: 0,
    quantity: null,
    quantityMax: null,
    row: null,
    col: null,
    displayName: null,
    children: [],
    ...over,
});

describe('countItems', () => {
    it('counts nested items, not just the top level', () => {
        // The nesting is the whole reason a tree is captured, so a count that stops
        // at the root would report a loaded rifle in a backpack as one item.
        const tree = [node('MountainBag', {
            children: [node('M4A1', { children: [node('Mag_STANAG_30Rnd')] })],
        })];
        expect(countNodes(tree)).toBe(3);
        expect(countItems(tree).size).toBe(3);
    });

    it('collapses duplicates by class', () => {
        const counts = countItems([node('Bandage'), node('Bandage'), node('Rag')]);
        expect(counts.get('Bandage')!.count).toBe(2);
        expect(counts.get('Rag')!.count).toBe(1);
    });

    it('never leaves a label blank', () => {
        // The catalog does not know every class — an item from a mod that has since
        // been removed, say — and a row with no text is worse than a raw classname.
        const counts = countItems([node('Some_Unknown_Class')]);
        expect(counts.get('Some_Unknown_Class')!.label).toBe('Some_Unknown_Class');
    });

    it('prefers the resolved display name when there is one', () => {
        const counts = countItems([node('M4A1', { displayName: 'M4-A1' })]);
        expect(counts.get('M4A1')!.label).toBe('M4-A1');
    });
});

describe('diffInventories', () => {
    it('reports what comes back and what is destroyed', () => {
        const snapshot = [node('M4A1'), node('Bandage')];
        const current = [node('Bandage'), node('Ammo_762x39')];
        const d = diffInventories(snapshot, current);
        expect(d.gained.map(i => i.cls)).toEqual(['M4A1']);
        expect(d.lost.map(i => i.cls)).toEqual(['Ammo_762x39']);
        expect(d.unchanged.map(i => i.cls)).toEqual(['Bandage']);
    });

    it('reports partial differences in count, not just presence', () => {
        // Three bandages restored over one is a gain of two, not "unchanged".
        const d = diffInventories(
            [node('Bandage'), node('Bandage'), node('Bandage')],
            [node('Bandage')],
        );
        expect(d.gained).toEqual([expect.objectContaining({ cls: 'Bandage', count: 2 })]);
        expect(d.lost).toEqual([]);
    });

    it('counts a surplus the restore would destroy', () => {
        const d = diffInventories([node('Bandage')], [node('Bandage'), node('Bandage')]);
        expect(d.lost).toEqual([expect.objectContaining({ cls: 'Bandage', count: 1 })]);
        expect(d.destroysNothing).toBe(false);
    });

    it('flags a restore that takes nothing away', () => {
        // A different situation from a destructive one, and the dialog should not
        // shout at an operator restoring onto a freshly spawned character.
        expect(diffInventories([node('M4A1')], []).destroysNothing).toBe(true);
    });

    it('sees through the hierarchy on both sides', () => {
        // The same rifle in a backpack and in hands is the same rifle. A structural
        // comparison would report it as both destroyed and restored.
        const d = diffInventories(
            [node('MountainBag', { children: [node('M4A1')] })],
            [node('M4A1', { where: 'hands' }), node('MountainBag')],
        );
        expect(d.gained).toEqual([]);
        expect(d.lost).toEqual([]);
    });

    it('orders the biggest change first', () => {
        const d = diffInventories(
            [node('Bandage'), node('Bandage'), node('Bandage'), node('M4A1')],
            [],
        );
        expect(d.gained.map(i => i.cls)).toEqual(['Bandage', 'M4A1']);
    });
});
