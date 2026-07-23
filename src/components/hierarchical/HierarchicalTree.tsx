import React, { useState, useMemo } from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { HierarchicalNodeItem, ChildListConfig } from './HierarchicalNodeItem';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';

class SmartPointerSensor extends PointerSensor {
  // NOTE: dnd-kit reads the static `activators` property (plural). Using the
  // singular `activator` silently falls back to the default PointerSensor
  // activator, which only allows the primary (left) button.
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        const target = event.target as HTMLElement;
        const isHandle = !!target.closest('[data-drag-handle]');

        // Allow both left (0, reorder) and right (2, copy) clicks on the handle.
        return isHandle && (event.button === 0 || event.button === 2);
      },
    },
  ];
}
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { findParent, findNode, cloneNodeWithNewIds, cloneNodeAsLink, buildNodeIndex } from '@/utils/tree';

interface HierarchicalTreeProps {
  items: LoadoutNode[];
  onUpdate: (items: LoadoutNode[]) => void;
  onSelect: (node: LoadoutNode) => void;
  /** Fired when a new child node is added inside the tree, so the caller can focus its classname. */
  onNodeCreated?: (node: LoadoutNode) => void;
  onAddTemplate: (nodeId: string, list: 'attachments' | 'cargo') => void;
  selectedNodeId: string | null;
  childLists?: ChildListConfig[];
  
  // Template resolution data
  allLoadouts?: Loadout[];
  randomPresets?: { presets: any[] };
  expansionAirdrops?: any;
  spawnableTypesByGroup?: any;
  isReadOnly?: boolean;
  /** Show the Duplicate button on root-level item rows (consumers with multiple roots). */
  allowRootDuplicate?: boolean;
}

export const HierarchicalTree: React.FC<HierarchicalTreeProps> = ({
  items,
  onUpdate,
  onSelect,
  onNodeCreated,
  onAddTemplate,
  selectedNodeId,
  childLists,
  allLoadouts,
  randomPresets,
  expansionAirdrops,
  spawnableTypesByGroup,
  isReadOnly = false,
  allowRootDuplicate = false
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isCopyDrag, setIsCopyDrag] = useState(false);

  // id -> node lookup so linked clones (linkedTo) can be resolved to their source sibling.
  const nodeIndex = useMemo(() => buildNodeIndex(items), [items]);

  const activeIdRef = React.useRef<string | null>(null);
  const isCopyDragRef = React.useRef(false);
  const isPotentialCopyDragRef = React.useRef(false);

  React.useEffect(() => {
    activeIdRef.current = activeId;
    isCopyDragRef.current = isCopyDrag;
  }, [activeId, isCopyDrag]);

  React.useEffect(() => {
    const handleDown = (e: MouseEvent | PointerEvent) => {
      if (e.button === 2) {
        const target = e.target as HTMLElement;
        if (target.closest('[data-drag-handle]')) {
          isPotentialCopyDragRef.current = true;
        }
      }
    };

    const handleUp = () => {
      // Small delay to allow contextmenu to fire and be blocked
      setTimeout(() => {
        isPotentialCopyDragRef.current = false;
      }, 50);
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (isPotentialCopyDragRef.current || activeIdRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('pointerdown', handleDown, true);
    window.addEventListener('mousedown', handleDown, true);
    window.addEventListener('pointerup', handleUp, true);
    window.addEventListener('mouseup', handleUp, true);
    window.addEventListener('contextmenu', handleContextMenu, true);

    return () => {
      window.removeEventListener('pointerdown', handleDown, true);
      window.removeEventListener('mousedown', handleDown, true);
      window.removeEventListener('pointerup', handleUp, true);
      window.removeEventListener('mouseup', handleUp, true);
      window.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, []);

  const sensors = useSensors(
    useSensor(SmartPointerSensor, {
      activationConstraint: {
        distance: 5, 
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const updateItem = (index: number, updatedItem: LoadoutNode) => {
    const next = [...items];
    next[index] = updatedItem;
    onUpdate(next);
  };

  const deleteItem = (index: number) => {
    const next = [...items];
    next.splice(index, 1);
    onUpdate(next);
  };

  const duplicateItem = (index: number) => {
    const source = items[index];
    // Duplicating an item creates a live, read-only linked clone; groups/templates keep the
    // old independent-copy behavior. A linked clone isn't selected (it's read-only).
    if (source.type === 'item') {
      const next = [...items];
      next.splice(index + 1, 0, cloneNodeAsLink(source));
      onUpdate(next);
      return;
    }
    const clone = cloneNodeWithNewIds(source);
    const next = [...items];
    next.splice(index + 1, 0, clone);
    onUpdate(next);
    onSelect(clone);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
    const nativeEvent = event.activatorEvent as any;
    
    // Determine if this is a copy operation
    const isCopy = isPotentialCopyDragRef.current || (nativeEvent && (
      (nativeEvent.button === 2) || 
      (nativeEvent.buttons & 2) || // For move events, button is often -1, use buttons bitmask
      (nativeEvent.ctrlKey === true) ||
      (nativeEvent.key === 'Control') // For keyboard sensor
    ));
    
    setIsCopyDrag(!!isCopy);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    
    if (!over || isReadOnly) return;

    if (active.id !== over.id) {
      const activeParent = findParent(items, active.id as string);
      const overParent = findParent(items, over.id as string);

      if (!activeParent) return;

      // Sibling Reorder (Left Click or same parent)
      if (!isCopyDrag && activeParent.parent?.id === overParent?.parent?.id && activeParent.list === overParent?.list) {
        if (activeParent.list === 'root') {
          const oldIndex = items.findIndex(i => i.id === active.id);
          const newIndex = items.findIndex(i => i.id === over.id);
          onUpdate(arrayMove(items, oldIndex, newIndex));
        } else {
          const parentNode = activeParent.parent!;
          const list = parentNode[activeParent.list] as LoadoutNode[];
          const oldIndex = list.findIndex(i => i.id === active.id);
          const newIndex = list.findIndex(i => i.id === over.id);
          
          const updatedParent = {
            ...parentNode,
            [activeParent.list]: arrayMove(list, oldIndex, newIndex)
          };
          
          // Need to update this parent in the global items list
          const nextItems = items.map(i => i.id === updatedParent.id ? updatedParent : i);
          // If it was deeper, we'd need a recursive update
          const fullyUpdatedItems = items.some(i => i.id === updatedParent.id) 
            ? nextItems 
            : items.map(i => {
                const updated = findAndReplaceNode(i, updatedParent);
                return updated;
              });
          onUpdate(fullyUpdatedItems);
        }
      } 
      // Copy (Right Click)
      else if (isCopyDrag) {
        const sourceNode = findNode(items, active.id as string);
        if (!sourceNode) return;

        // Drag-copy of an item produces a linked clone (live mirror); groups/templates copy
        // independently, as before.
        const newNode = sourceNode.type === 'item'
          ? cloneNodeAsLink(sourceNode)
          : cloneNodeWithNewIds(sourceNode);

        let targetParent: LoadoutNode | null = null;
        let targetListKey: 'attachments' | 'cargo' | 'variants' | 'root' = 'root';
        let targetIndex = 0;

        if (over.id.toString().startsWith('droppable:')) {
          const [, parentId, listKey] = over.id.toString().split(':');
          targetParent = findNode(items, parentId);
          targetListKey = listKey as any;
          targetIndex = 0;
        } else {
          const overParent = findParent(items, over.id as string);
          if (overParent) {
            targetParent = overParent.parent;
            targetListKey = overParent.list;
            targetIndex = overParent.index;
          }
        }

        if (targetListKey === 'root') {
          const next = [...items];
          next.splice(targetIndex, 0, newNode);
          onUpdate(next);
        } else if (targetParent) {
          const list = [...(targetParent[targetListKey] as LoadoutNode[])];
          list.splice(targetIndex, 0, newNode);
          
          const updatedParent = { ...targetParent, [targetListKey]: list };
          onUpdate(items.map(i => {
            if (i.id === updatedParent.id) return updatedParent;
            return findAndReplaceNode(i, updatedParent);
          }));
        }
      }
    }
  };

  const findAndReplaceNode = (root: LoadoutNode, updated: LoadoutNode): LoadoutNode => {
    if (root.id === updated.id) return updated;
    return {
      ...root,
      attachments: (root.attachments || []).map(a => findAndReplaceNode(a, updated)),
      cargo: (root.cargo || []).map(c => findAndReplaceNode(c, updated)),
      ...(root.variants ? { variants: root.variants.map(v => findAndReplaceNode(v, updated)) } : {})
    };
  };

  const activeNode = activeId ? findNode(items, activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-2">
        <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          {items.map((item, idx) => (
            <HierarchicalNodeItem
              key={item.id}
              node={item}
              onUpdate={(updated) => updateItem(idx, updated)}
              onDelete={() => deleteItem(idx)}
              onDuplicate={allowRootDuplicate ? () => duplicateItem(idx) : undefined}
              onSelect={onSelect}
              onNodeCreated={onNodeCreated}
              onAddTemplate={(list) => onAddTemplate(item.id, list)}
              selectedNodeId={selectedNodeId}
              childLists={childLists}
              allLoadouts={allLoadouts}
              randomPresets={randomPresets}
              expansionAirdrops={expansionAirdrops}
              spawnableTypesByGroup={spawnableTypesByGroup}
              isReadOnly={isReadOnly}
              nodeIndex={nodeIndex}
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: '0.5',
              },
            },
          }),
        }}
      >
        {activeId && activeNode ? (
          <div className="opacity-80 pointer-events-none scale-105">
            <HierarchicalNodeItem
              node={activeNode}
              onUpdate={() => {}}
              onDelete={() => {}}
              onSelect={() => {}}
              onAddTemplate={() => {}}
              selectedNodeId={null}
              isReadOnly={true}
              childLists={childLists}
              allLoadouts={allLoadouts}
              randomPresets={randomPresets}
              expansionAirdrops={expansionAirdrops}
              spawnableTypesByGroup={spawnableTypesByGroup}
              nodeIndex={nodeIndex}
            />
            {isCopyDrag && (
              <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-lg font-bold uppercase">
                Copying
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
