/**
 * Comparing two captured loadouts.
 *
 * A rollback replaces everything a player is carrying with everything a snapshot
 * recorded, and the operator has to be able to see what that trade actually is
 * before they agree to it. That is a set difference over item COUNTS, not a tree
 * diff: nobody cares that a bandage moved from one pocket to another, and a
 * structural diff would report exactly that as a change while burying the fact
 * that a rifle is about to be duplicated.
 *
 * Counted by classname, because that is the only identity a DayZ item has that
 * survives being destroyed and recreated — which is precisely what a restore does.
 */

import type { InventoryNode } from '@/types/history';

export interface ItemCount {
  cls: string;
  /** Catalog name where we have one; the classname is the fallback, never blank. */
  label: string;
  count: number;
}

/** Flatten a tree into per-class counts, ignoring where each item sat. */
export function countItems(tree: InventoryNode[]): Map<string, ItemCount> {
  const out = new Map<string, ItemCount>();
  const walk = (nodes: InventoryNode[]) => {
    for (const n of nodes) {
      const existing = out.get(n.cls);
      if (existing) existing.count += 1;
      else out.set(n.cls, { cls: n.cls, label: n.displayName || n.cls, count: 1 });
      walk(n.children || []);
    }
  };
  walk(tree);
  return out;
}

/** Total nodes in a tree, including nested ones. */
export function countNodes(tree: InventoryNode[]): number {
  let n = 0;
  for (const node of tree) n += 1 + countNodes(node.children || []);
  return n;
}

export interface InventoryDiff {
  /** In the snapshot but not currently carried — what the restore gives back. */
  gained: ItemCount[];
  /** Currently carried but not in the snapshot — what the restore DESTROYS. */
  lost: ItemCount[];
  /** In both, at the same count. Listed so "nothing changes" is visible. */
  unchanged: ItemCount[];
  /**
   * True when nothing at all is being taken away.
   *
   * Worth its own flag: an operator restoring onto a freshly spawned character is
   * in a completely different situation from one restoring over a full loadout,
   * and the dialog should not shout at the first.
   */
  destroysNothing: boolean;
}

/**
 * What restoring `snapshot` onto a player currently carrying `current` would do.
 *
 * `current` may be null — a player whose inventory has never been captured. That
 * is NOT the same as an empty inventory, and the caller must say so rather than
 * rendering an empty `lost` list as "nothing will be destroyed".
 */
export function diffInventories(
  snapshot: InventoryNode[],
  current: InventoryNode[],
): InventoryDiff {
  const want = countItems(snapshot);
  const have = countItems(current);

  const gained: ItemCount[] = [];
  const lost: ItemCount[] = [];
  const unchanged: ItemCount[] = [];

  for (const [cls, w] of want) {
    const h = have.get(cls);
    if (!h) { gained.push({ ...w }); continue; }
    if (w.count > h.count) gained.push({ ...w, count: w.count - h.count });
    else if (w.count < h.count) lost.push({ ...h, count: h.count - w.count });
    else unchanged.push({ ...w });
  }
  for (const [cls, h] of have) {
    if (!want.has(cls)) lost.push({ ...h });
  }

  const byCount = (a: ItemCount, b: ItemCount) => b.count - a.count || a.label.localeCompare(b.label);
  gained.sort(byCount);
  lost.sort(byCount);
  unchanged.sort(byCount);

  return { gained, lost, unchanged, destroysNothing: lost.length === 0 };
}
