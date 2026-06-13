export function findNode<T extends { id: string, attachments?: T[], cargo?: T[] }>(
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
  }
  return null;
}

export function updateNodeInList<T extends { id: string, attachments?: T[], cargo?: T[] }>(
  nodes: T[], 
  updatedNode: T
): T[] {
  return nodes.map(node => {
    if (node.id === updatedNode.id) return updatedNode;
    
    let nextNode = { ...node };
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
    
    return changed ? nextNode : node;
  });
}

export function reorderList<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

export function findParent<T extends { id: string, attachments?: T[], cargo?: T[] }>(
  nodes: T[], 
  id: string
): { parent: T | null, list: 'attachments' | 'cargo' | 'root', index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { parent: null, list: 'root', index: i };
    }
    
    if (nodes[i].attachments) {
      const children = nodes[i].attachments!;
      for (let j = 0; j < children.length; j++) {
        if (children[j].id === id) {
          return { parent: nodes[i], list: 'attachments', index: j };
        }
        const found = findParent(children, id);
        if (found) return found;
      }
    }
    
    if (nodes[i].cargo) {
      const children = nodes[i].cargo!;
      for (let j = 0; j < children.length; j++) {
        if (children[j].id === id) {
          return { parent: nodes[i], list: 'cargo', index: j };
        }
        const found = findParent(children, id);
        if (found) return found;
      }
    }
  }
  return null;
}
