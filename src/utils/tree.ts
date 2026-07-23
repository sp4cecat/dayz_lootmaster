import { LoadoutNode } from '@/types/loadouts';

export function findNode<T extends { id: string, attachments?: T[], cargo?: T[], variants?: T[] }>(
  nodes: T[],
  id: string
): T | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.attachments) {
      const found = findNode(node.attachments, id);
      if (found) return found;
    }
    if (node.cargo) {
      const found = findNode(node.cargo, id);
      if (found) return found;
    }
    if (node.variants) {
      const found = findNode(node.variants, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateNodeInList<T extends { id: string, attachments?: T[], cargo?: T[], variants?: T[] }>(
  nodes: T[],
  updatedNode: T
): T[] {
  return nodes.map(node => {
    if (node.id === updatedNode.id) return updatedNode;

    const nextNode = { ...node };
    let changed = false;

    if (node.attachments) {
      const nextAttachments = updateNodeInList(node.attachments, updatedNode);
      if (nextAttachments !== node.attachments) {
        nextNode.attachments = nextAttachments;
        changed = true;
      }
    }

    if (node.cargo) {
      const nextCargo = updateNodeInList(node.cargo, updatedNode);
      if (nextCargo !== node.cargo) {
        nextNode.cargo = nextCargo;
        changed = true;
      }
    }

    if (node.variants) {
      const nextVariants = updateNodeInList(node.variants, updatedNode);
      if (nextVariants !== node.variants) {
        nextNode.variants = nextVariants;
        changed = true;
      }
    }

    return changed ? nextNode : node;
  });
}

// Deep-clones a node and assigns a fresh crypto.randomUUID() to it and every
// attachments/cargo descendant, so a duplicated subtree carries no shared IDs with the
// original. Used by the Duplicate action and the right-click drag-copy in HierarchicalTree.
export function cloneNodeWithNewIds<T extends { id: string, attachments?: T[], cargo?: T[], variants?: T[] }>(node: T): T {
  const deep = JSON.parse(JSON.stringify(node)) as T;
  const reId = (n: T): T => ({
    ...n,
    id: crypto.randomUUID(),
    attachments: (n.attachments || []).map(reId) as T[],
    cargo: (n.cargo || []).map(reId) as T[],
    // Only re-attach variants when present so we don't add an empty array to nodes that
    // never had one (attachments/group members carry no variants).
    ...(n.variants ? { variants: n.variants.map(reId) as T[] } : {}),
  });
  return reId(deep);
}

// Walks a tree and returns an id -> node lookup, used to resolve `linkedTo` sibling links.
export function buildNodeIndex(nodes: LoadoutNode[]): Map<string, LoadoutNode> {
  const index = new Map<string, LoadoutNode>();
  const walk = (list: LoadoutNode[]) => {
    for (const node of list) {
      index.set(node.id, node);
      if (node.attachments) walk(node.attachments);
      if (node.cargo) walk(node.cargo);
      if (node.variants) walk(node.variants);
    }
  };
  walk(nodes);
  return index;
}

// Resolves a linked clone to a display node carrying its source's content but the clone's own
// identity (id), link marker, and UI expand state. Follows `linkedTo` chains and guards cycles.
// Returns `node` unchanged when it isn't linked or its source can't be found.
export function resolveLinkedNode(
  node: LoadoutNode,
  index: Map<string, LoadoutNode>,
  seen: Set<string> = new Set()
): LoadoutNode {
  if (!node.linkedTo || seen.has(node.id)) return node;
  const source = index.get(node.linkedTo);
  if (!source) return node;
  seen.add(node.id);
  const resolvedSource = resolveLinkedNode(source, index, seen);
  return {
    ...resolvedSource,
    id: node.id,
    linkedTo: node.linkedTo,
    isExpanded: node.isExpanded,
  };
}

// Deep-clones a node (fresh IDs) and marks it a linked clone of `source`. When `source` is
// itself a clone, links to the ORIGINAL source so links never chain.
export function cloneNodeAsLink(source: LoadoutNode): LoadoutNode {
  return { ...cloneNodeWithNewIds(source), linkedTo: source.linkedTo ?? source.id };
}

// Turns a linked clone into an independent editable copy: bakes in a fresh-ID deep clone of
// the currently-mirrored source content, keeping the clone's own id/expand state, and drops
// the link. If the source is gone, just strips the link off the node's stale stored content.
export function unlinkNode(node: LoadoutNode, index: Map<string, LoadoutNode>): LoadoutNode {
  const resolved = resolveLinkedNode(node, index);
  const baked = cloneNodeWithNewIds(resolved);
  return { ...baked, id: node.id, isExpanded: node.isExpanded, linkedTo: undefined };
}

// Recursively replaces every linked clone with a fresh-ID deep clone of its resolved source
// content (dropping the link), producing a link-free tree for DayZ-format export.
export function materializeLinkedClones(
  nodes: LoadoutNode[],
  index: Map<string, LoadoutNode>,
  seen: Set<string> = new Set()
): LoadoutNode[] {
  return nodes.map(node => {
    let resolved: LoadoutNode = node;
    if (node.linkedTo && !seen.has(node.id)) {
      const r = resolveLinkedNode(node, index, new Set(seen));
      if (r !== node) resolved = { ...cloneNodeWithNewIds(r), id: node.id, linkedTo: undefined };
    }
    const nextSeen = new Set(seen).add(node.id);
    return {
      ...resolved,
      attachments: resolved.attachments
        ? materializeLinkedClones(resolved.attachments, index, nextSeen)
        : resolved.attachments,
      cargo: resolved.cargo
        ? materializeLinkedClones(resolved.cargo, index, nextSeen)
        : resolved.cargo,
      variants: resolved.variants
        ? materializeLinkedClones(resolved.variants, index, nextSeen)
        : resolved.variants,
    };
  });
}

// Repairs item classnames polluted by the old classname-picker bug (which stored the combined
// "<Class> <DisplayName>" textValue instead of the bare class). Applies `repair` to every item
// node's name, recursing through attachments/cargo, and leaves template/group node names alone
// (those hold preset/template refs and group labels, not classnames). Returns the SAME array
// reference when nothing changed so callers can skip a state write; only rebuilds touched nodes.
export function repairItemClassNames(
  nodes: LoadoutNode[],
  repair: (name: string) => string
): { nodes: LoadoutNode[]; changed: boolean } {
  let changed = false;
  const mapped = nodes.map(node => {
    const att = repairItemClassNames(node.attachments || [], repair);
    const car = repairItemClassNames(node.cargo || [], repair);
    const varr = node.variants ? repairItemClassNames(node.variants, repair) : null;
    const name = node.type === 'item' ? repair(node.name) : node.name;
    if (name !== node.name || att.changed || car.changed || varr?.changed) {
      changed = true;
      return {
        ...node,
        name,
        // Preserve the original (possibly undefined) child arrays when untouched.
        attachments: att.changed ? att.nodes : node.attachments,
        cargo: car.changed ? car.nodes : node.cargo,
        variants: varr?.changed ? varr.nodes : node.variants,
      };
    }
    return node;
  });
  return { nodes: changed ? mapped : nodes, changed };
}

export function reorderList<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

export function findParent<T extends { id: string, attachments?: T[], cargo?: T[], variants?: T[] }>(
  nodes: T[],
  id: string,
  parent: T | null = null,
  list: 'attachments' | 'cargo' | 'variants' | 'root' = 'root'
): { parent: T | null, list: 'attachments' | 'cargo' | 'variants' | 'root', index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { parent, list, index: i };
    }

    if (nodes[i].attachments) {
      const found = findParent(nodes[i].attachments!, id, nodes[i], 'attachments');
      if (found) return found;
    }

    if (nodes[i].cargo) {
      const found = findParent(nodes[i].cargo!, id, nodes[i], 'cargo');
      if (found) return found;
    }

    if (nodes[i].variants) {
      const found = findParent(nodes[i].variants!, id, nodes[i], 'variants');
      if (found) return found;
    }
  }
  return null;
}
