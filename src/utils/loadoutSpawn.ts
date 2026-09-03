import type { LoadoutNode } from '../types/loadouts';

/**
 * Turns a loadout tree into a concrete list of things to spawn on the ground.
 *
 * ## Why the rolling happens here and not in the mod
 *
 * A loadout is a *probability* tree: nodes carry a `chance`, group nodes pick one
 * member by weighted chance, and quantities are ranges. The mod-side spawn action
 * should receive an already-decided tree — "create these exact items" — so all the
 * randomness lives in TypeScript where it is cheap to unit-test, and the Enforce
 * Script stays a dumb walker. `rng` is injectable for exactly that reason, the same
 * convention `utils/airdropSimulator.ts` uses.
 *
 * ## Why not flattenLoadoutItems
 *
 * `flattenLoadoutItems` (live/PlayerActionsBar.tsx) returns bare class names: it
 * drops every quantity, flattens attachment/cargo nesting, and silently contributes
 * nothing for `template` nodes because it never resolves them. That is tolerable for
 * spawning onto a player, where CFCloud_SpawnPlayerItem can't express nesting anyway.
 * A ground pile can do better, so this builds the real tree instead.
 *
 * Callers must pass nodes that have already been through `resolveLoadoutNode`
 * (utils/loadouts.ts) — template resolution needs the loadout library, presets and
 * airdrop containers, which this module deliberately doesn't know about.
 *
 * `variants` are skipped, matching every other consumer: they are alternates of the
 * parent, not additional items.
 */

export interface SpawnTreeNode {
  className: string;
  /** How many to create. Always >= 1. */
  quantity: number;
  /**
   * Fill level as a percentage, when the loadout specified one. Absent means "use
   * the item's own default". Mirrors Expansion's QuantityPercent, where -1 is the
   * default sentinel and -2 means "let the central economy decide".
   */
  quantityPercent?: number;
  attachments: SpawnTreeNode[];
  cargo: SpawnTreeNode[];
}

export type Rng = () => number;

/** Inclusive integer in [min, max]. */
function randInt(min: number, max: number, rng: Rng): number {
  if (!(max > min)) return Math.max(1, Math.trunc(min) || 1);
  return Math.trunc(min) + Math.floor(rng() * (Math.trunc(max) - Math.trunc(min) + 1));
}

function rollQuantity(node: LoadoutNode, rng: Rng): { quantity: number; quantityPercent?: number } {
  const q = node.quantity;
  if (!q) return { quantity: 1 };
  const min = Number.isFinite(q.min) ? q.min : 1;
  const max = Number.isFinite(q.max) ? q.max : min;
  // A percent > 0 is a fill level, not a count: one item, partly full.
  const percent = Number.isFinite(q.percent) && q.percent > 0 ? q.percent : undefined;
  return { quantity: Math.max(1, randInt(min, max, rng)), quantityPercent: percent };
}

/**
 * Group nodes hold candidate members in `attachments` and mean "roll this block,
 * then pick exactly one member". Selection is weighted by each member's own chance,
 * so a member with chance 0 can never win — matching how the editor presents it.
 * Returns null when every candidate has zero weight.
 */
function pickGroupMember(members: LoadoutNode[], rng: Rng): LoadoutNode | null {
  const weights = members.map(m => Math.max(0, Number(m.chance ?? 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (let i = 0; i < members.length; i++) {
    roll -= weights[i];
    if (roll < 0) return members[i];
  }
  return members[members.length - 1];
}

function buildOne(node: LoadoutNode, rng: Rng): SpawnTreeNode[] {
  // `chance` is the gate for every node kind, groups included.
  const chance = Number(node.chance ?? 1);
  if (chance < 1 && rng() >= chance) return [];

  if (node.type === 'group') {
    const member = pickGroupMember(node.attachments || [], rng);
    return member ? buildOne(member, rng) : [];
  }

  // A template that survived to here was never resolved (its source is gone, or the
  // caller skipped resolveLoadoutNode). Contribute nothing rather than spawning a
  // loadout id as if it were a class name.
  if (node.type === 'template' || !node.name) return [];

  const { quantity, quantityPercent } = rollQuantity(node, rng);
  const out: SpawnTreeNode = {
    className: node.name,
    quantity,
    attachments: buildMany(node.attachments || [], rng),
    cargo: buildMany(node.cargo || [], rng),
  };
  if (quantityPercent !== undefined) out.quantityPercent = quantityPercent;
  return [out];
}

function buildMany(nodes: LoadoutNode[], rng: Rng): SpawnTreeNode[] {
  return nodes.flatMap(n => buildOne(n, rng));
}

/** Roll a resolved loadout tree into the concrete items to create. */
export function buildSpawnTree(nodes: LoadoutNode[] | undefined, rng: Rng = Math.random): SpawnTreeNode[] {
  return buildMany(nodes || [], rng);
}

/**
 * Every item in the tree as a flat list, nesting discarded.
 *
 * This is the degraded path for servers without the spacecat spawn action, where
 * each item has to go out as its own CFCloud_SpawnItemWorld call. Deriving it from
 * the same rolled tree rather than from the loadout means both paths always agree on
 * *what* spawns — they differ only in whether it ends up nested or in a heap.
 */
export function flattenSpawnTree(tree: SpawnTreeNode[]): { className: string; quantity: number }[] {
  const out: { className: string; quantity: number }[] = [];
  const walk = (n: SpawnTreeNode) => {
    out.push({ className: n.className, quantity: n.quantity });
    n.attachments.forEach(walk);
    n.cargo.forEach(walk);
  };
  tree.forEach(walk);
  return out;
}

/** Total items in the tree, for "spawn 23 items here?" in the confirmation. */
export function countSpawnTree(tree: SpawnTreeNode[]): number {
  return flattenSpawnTree(tree).length;
}
