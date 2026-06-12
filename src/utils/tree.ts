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
