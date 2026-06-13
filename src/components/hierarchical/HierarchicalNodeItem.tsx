import React from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { ChevronRight, ChevronDown, Plus, Trash2, Package, Layers, Settings2, GripVertical } from 'lucide-react';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';
import { useResolvedNode } from '@/hooks/useResolvedNode';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';

export interface ChildListConfig {
  key: 'attachments' | 'cargo';
  label: string;
  icon: any;
}

interface HierarchicalNodeItemProps {
  node: LoadoutNode;
  onUpdate: (updatedNode: LoadoutNode) => void;
  onDelete: () => void;
  onSelect: (node: LoadoutNode) => void;
  onAddTemplate: (list: 'attachments' | 'cargo') => void;
  selectedNodeId: string | null;
  depth?: number;
  defaultExpanded?: boolean;
  childLists?: ChildListConfig[];
  
  // Template resolution data
  allLoadouts?: Loadout[];
  randomPresets?: { presets: any[] };
  expansionAirdrops?: any;
  spawnableTypesByGroup?: any;
  isReadOnly?: boolean;
}

const DroppablePlaceholder: React.FC<{ id: string, label: string }> = ({ id, label }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div 
      ref={setNodeRef}
      className={cx(
        "text-[10px] text-gray-400 italic p-2 rounded border border-dashed transition-colors",
        isOver ? "bg-primary-50 border-primary-300 text-primary-600" : "border-transparent"
      )}
    >
      No {label.toLowerCase()}
    </div>
  );
};

export const HierarchicalNodeItem: React.FC<HierarchicalNodeItemProps> = ({
  node,
  onUpdate,
  onDelete,
  onSelect,
  onAddTemplate,
  selectedNodeId,
  depth = 0,
  defaultExpanded = false,
  childLists = [
    { key: 'attachments', label: 'Attachments', icon: Settings2 },
    { key: 'cargo', label: 'Cargo', icon: Package }
  ],
  allLoadouts = [],
  randomPresets,
  expansionAirdrops,
  spawnableTypesByGroup,
  isReadOnly = false
}) => {
  const [localExpanded, setLocalExpanded] = React.useState(defaultExpanded);
  const isExpanded = isReadOnly ? localExpanded : (node.isExpanded ?? defaultExpanded);
  const isSelected = selectedNodeId === node.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: node.id,
    disabled: isReadOnly 
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const resolvedChildren = useResolvedNode(
    node, 
    allLoadouts, 
    randomPresets, 
    expansionAirdrops, 
    spawnableTypesByGroup
  );

  const handleAddChild = (list: 'attachments' | 'cargo') => {
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: '',
      chance: 1.0,
      attachments: [],
      cargo: [],
      isExpanded: false
    };

    const updatedAttachments = node.attachments.map(child => ({
      ...child,
      isExpanded: child.id === selectedNodeId ? false : child.isExpanded
    }));
    const updatedCargo = node.cargo.map(child => ({
      ...child,
      isExpanded: child.id === selectedNodeId ? false : child.isExpanded
    }));

    onUpdate({
      ...node,
      attachments: list === 'attachments' ? [...updatedAttachments, newNode] : updatedAttachments,
      cargo: list === 'cargo' ? [...updatedCargo, newNode] : updatedCargo,
      isExpanded: true
    });
    onSelect(newNode);
  };

  const updateChild = (list: 'attachments' | 'cargo', index: number, updatedChild: LoadoutNode) => {
    const newList = [...node[list]];
    newList[index] = updatedChild;
    onUpdate({ ...node, [list]: newList });
  };

  const deleteChild = (list: 'attachments' | 'cargo', index: number) => {
    const newList = [...node[list]];
    newList.splice(index, 1);
    onUpdate({ ...node, [list]: newList });
  };

  return (
    <div className="space-y-1" ref={setNodeRef} style={style}>
      <div 
        className={cx(
          "flex items-center group px-3 py-2 rounded-lg cursor-pointer border transition-all",
          isSelected 
            ? "bg-primary-50 border-primary-200 dark:bg-primary-900/20 dark:border-primary-800" 
            : "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700",
          isReadOnly && "opacity-60 grayscale-[0.5] cursor-default"
        )}
        onClick={() => !isReadOnly && onSelect(node)}
      >
        {!isReadOnly && (
          <div 
            {...attributes} 
            {...listeners}
            className="mr-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing"
            onContextMenu={(e) => {
              // Only prevent context menu if we are dragging with right click
              // This is a bit tricky to detect here, so we might just let it be or handle it in dnd-kit
            }}
          >
            <GripVertical size={16} />
          </div>
        )}

        <button 
          onClick={(e) => { 
            e.stopPropagation(); 
            if (isReadOnly) {
              setLocalExpanded(!isExpanded);
            } else {
              onUpdate({ ...node, isExpanded: !isExpanded }); 
            }
          }}
          className="mr-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-400"
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className={cx(
          "p-1.5 rounded mr-3",
          node.type === 'template' ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
        )}>
          {node.type === 'template' ? <Layers size={14} /> : <Package size={14} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate text-sm">{node.name || (node.type === 'item' ? 'Unnamed Item' : 'Unnamed Template')}</span>
            <Badge color="gray" size="sm">{(node.chance * 100).toFixed(0)}%</Badge>
            {node.type === 'template' && <Badge color="warning" size="sm">Template</Badge>}
            {isReadOnly && <Badge color="gray" size="sm">Linked</Badge>}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isReadOnly && (
            <>
              <Button 
                variant="secondary" 
                size="sm" 
                className="h-8 w-8 p-0"
                onClick={(e) => { e.stopPropagation(); onSelect(node); }}
              >
                <Settings2 size={14} />
              </Button>
              <Button 
                variant="secondary" 
                size="sm" 
                className="h-8 w-8 p-0 text-error-600"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="ml-6 pl-4 border-l-2 border-gray-100 dark:border-gray-800 space-y-4 py-2">
          {childLists.map((listConfig) => {
             const children = resolvedChildren[listConfig.key] || [];
             return (
              <div key={listConfig.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{listConfig.label}</span>
                  {!isReadOnly && (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => onAddTemplate(listConfig.key)}
                        className="text-xs text-amber-600 hover:underline flex items-center"
                      >
                        <Layers size={12} className="mr-1" /> Template
                      </button>
                      <button 
                        onClick={() => handleAddChild(listConfig.key)}
                        className="text-xs text-primary-600 hover:underline flex items-center"
                      >
                        <Plus size={12} className="mr-1" /> Add
                      </button>
                    </div>
                  )}
                </div>
                {children.length > 0 ? (
                  <div className="space-y-1">
                    <SortableContext items={children.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      {children.map((child, idx) => (
                        <HierarchicalNodeItem 
                          key={child.id}
                          node={child}
                          onUpdate={(updated) => updateChild(listConfig.key, idx, updated)}
                          onDelete={() => deleteChild(listConfig.key, idx)}
                          onSelect={onSelect}
                          onAddTemplate={onAddTemplate}
                          selectedNodeId={selectedNodeId}
                          depth={depth + 1}
                          childLists={childLists}
                          allLoadouts={allLoadouts}
                          randomPresets={randomPresets}
                          expansionAirdrops={expansionAirdrops}
                          spawnableTypesByGroup={spawnableTypesByGroup}
                          isReadOnly={isReadOnly || node.type === 'template'}
                        />
                      ))}
                    </SortableContext>
                  </div>
                ) : (
                  <DroppablePlaceholder 
                    id={`droppable:${node.id}:${listConfig.key}`} 
                    label={listConfig.label} 
                  />
                )}
              </div>
             );
          })}
        </div>
      )}
    </div>
  );
};
