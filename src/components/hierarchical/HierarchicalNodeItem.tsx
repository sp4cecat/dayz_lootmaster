import React from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { ChevronRight, ChevronDown, Plus, Trash2, Package, Layers, Settings2, GripVertical, Boxes, Copy, Unlink } from 'lucide-react';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';
import { cloneNodeWithNewIds, cloneNodeAsLink, resolveLinkedNode, unlinkNode } from '@/utils/tree';
import { useResolvedNode } from '@/hooks/useResolvedNode';
import { useItemCapabilities, useAttachmentSlots, useCatalog } from '@/contexts/CatalogContext';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { Button as AriaButton } from 'react-aria-components';

// Sentinel menu key for "create an unassigned (generic) group", distinct from any slot name.
const UNASSIGNED_SLOT = '__unassigned__';

export interface ChildListConfig {
  key: 'attachments' | 'cargo' | 'variants';
  label: string;
  icon: any;
  /** Which catalog capability decides whether this list is offered. Defaults to `key`.
   *  'either' offers the list when the item accepts attachments OR holds cargo — used by
   *  Expansion airdrop loot, whose single "attachments" list represents all container
   *  contents (Expansion folds cargo into attachments via ExpansionCreateInInventory), so a
   *  cargo-only container (e.g. Bear_Pink) must still accept children. */
  gate?: 'attachments' | 'cargo' | 'either';
}

interface HierarchicalNodeItemProps {
  node: LoadoutNode;
  onUpdate: (updatedNode: LoadoutNode) => void;
  onDelete: () => void;
  /** Insert a fresh-ID copy of this node as a sibling. Omitted -> no Duplicate button. */
  onDuplicate?: () => void;
  onSelect: (node: LoadoutNode) => void;
  /** Fired when a brand-new child node is added (in addition to onSelect), so a caller can
   *  focus+select its classname input. */
  onNodeCreated?: (node: LoadoutNode) => void;
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
  /** id -> node lookup for resolving linked clones (nodes with `linkedTo`) to their source. */
  nodeIndex?: Map<string, LoadoutNode>;
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
  onDuplicate,
  onSelect,
  onNodeCreated,
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
  isReadOnly = false,
  nodeIndex
}) => {
  // A linked clone mirrors its source sibling live and is immutable until "Unlink" is used.
  // `displayNode` carries the source's content but this node's own id/expand state.
  const isLinked = !!node.linkedTo;
  const displayNode = React.useMemo(
    () => (isLinked && nodeIndex ? resolveLinkedNode(node, nodeIndex) : node),
    [isLinked, node, nodeIndex]
  );
  // Linked clones are read-only for editing, but still selectable so their mirrored values can
  // be inspected in the properties panel.
  const editLocked = isReadOnly || isLinked;

  const [localExpanded, setLocalExpanded] = React.useState(defaultExpanded);
  const isExpanded = editLocked ? localExpanded : (node.isExpanded ?? defaultExpanded);
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
    disabled: editLocked
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const resolvedChildren = useResolvedNode(
    displayNode,
    allLoadouts,
    randomPresets,
    expansionAirdrops,
    spawnableTypesByGroup
  );

  // A group node renders a single members list (its `attachments`) instead of the
  // default Attachments + Cargo lists. Its kind (attachments vs cargo) is implied by
  // which parent list it lives in.
  const isGroup = displayNode.type === 'group';
  // The Variants list (Expansion item-level select-one alternatives) only makes sense on a
  // root loot item — a variant, and any attachment, must not itself nest a Variants list — so
  // strip it below depth 0. A group renders only its members list.
  const effectiveChildLists: ChildListConfig[] = isGroup
    ? [{ key: 'attachments', label: 'Items', icon: Package }]
    : childLists.filter(c => c.key !== 'variants' || depth === 0);

  // Companion-mod catalog capabilities for this class. Only item nodes map to a real
  // class; group/template nodes are structural, so we skip them. null capability means
  // the catalog can't answer (mod down / unknown) -> keep offering the option.
  const gateName = (!isGroup && displayNode.type === 'item') ? displayNode.name : undefined;
  const { acceptsAttachments, holdsCargo } = useItemCapabilities(gateName);

  // Root item rows show the catalog display name in small text beneath the classname.
  const { displayNameFor } = useCatalog();
  const rootDisplayName = depth === 0 && displayNode.type === 'item'
    ? displayNameFor(displayNode.name)
    : undefined;

  // Attachment slots this item exposes (from the catalog attachments[] feed), offered when
  // creating a group so it can be linked to a specific slot. Only fetched for item nodes.
  const slotGraph = useAttachmentSlots(gateName);
  const slotOptions = React.useMemo(() => {
    if (!slotGraph) return [] as { slot: string; count: number }[];
    const slots = slotGraph.slots?.length ? slotGraph.slots : Object.keys(slotGraph.bySlot || {});
    return slots.map(s => ({ slot: s, count: (slotGraph.bySlot?.[s] || []).length }));
  }, [slotGraph]);
  const listOffered = (cfg: ChildListConfig): boolean => {
    if (isGroup) return true; // group members list is not catalog-gated
    if (cfg.key === 'variants') return true; // variants are always available on a root item
    const gate = cfg.gate ?? cfg.key;
    if (gate === 'either') return acceptsAttachments !== false || holdsCargo !== false;
    return gate === 'cargo' ? holdsCargo !== false : acceptsAttachments !== false;
  };
  const emptyNote = (cfg: ChildListConfig): string => {
    const gate = cfg.gate ?? cfg.key;
    if (gate === 'either') return 'This item can hold no contents';
    return gate === 'cargo' ? 'This item has no cargo capacity' : 'This item exposes no attachment slots';
  };

  // An item that the catalog says can hold neither attachments nor cargo has no child
  // options to open — so hide the expand chevron entirely. We still allow expansion when
  // the catalog can't answer (null) or when the node already has children to show, so no
  // existing config becomes unreachable.
  const noChildCapacity = !isGroup && displayNode.type === 'item'
    && acceptsAttachments === false && holdsCargo === false;
  const hasChildren = (resolvedChildren.attachments?.length || 0) > 0
    || (resolvedChildren.cargo?.length || 0) > 0
    || (displayNode.variants?.length || 0) > 0;
  // A root item always exposes the Variants list, so it must stay expandable even when the
  // catalog says it holds no attachments/cargo.
  const hasVariantsList = effectiveChildLists.some(c => c.key === 'variants');
  const canExpand = !noChildCapacity || hasChildren || hasVariantsList;

  type ChildKey = 'attachments' | 'cargo' | 'variants';

  const handleAddChild = (list: ChildKey) => {
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: '',
      chance: 1.0,
      attachments: [],
      cargo: [],
      isExpanded: false
    };

    // Collapse the currently-selected sibling in the target list so the new row is visible.
    const collapsed = (node[list] || []).map(child => ({
      ...child,
      isExpanded: child.id === selectedNodeId ? false : child.isExpanded
    }));

    onUpdate({ ...node, [list]: [...collapsed, newNode], isExpanded: true });
    onSelect(newNode);
    onNodeCreated?.(newNode);
  };

  // Seed a new variant from the base item itself: a fresh-id deep copy of this item (its
  // Contents included) minus its own variants. Reuses cloneNodeWithNewIds — no serialization.
  const cloneItemToVariant = () => {
    // Type the base explicitly as LoadoutNode: cloneNodeWithNewIds' recursive generic
    // constraint won't infer cleanly through an inline spread literal.
    const base: LoadoutNode = { ...node, variants: [], isExpanded: false };
    const seed = cloneNodeWithNewIds(base);
    onUpdate({ ...node, variants: [...(node.variants || []), seed], isExpanded: true });
    onSelect(seed);
    onNodeCreated?.(seed);
  };

  const updateChild = (list: ChildKey, index: number, updatedChild: LoadoutNode) => {
    const newList = [...(node[list] || [])];
    newList[index] = updatedChild;
    onUpdate({ ...node, [list]: newList });
  };

  const deleteChild = (list: ChildKey, index: number) => {
    const newList = [...(node[list] || [])];
    newList.splice(index, 1);
    onUpdate({ ...node, [list]: newList });
  };

  // Duplicating an attachment/cargo item inserts a live, read-only linked clone directly after
  // it (groups/templates keep the independent-copy behavior). Variants instead clone as an
  // INDEPENDENT copy — they're meant to diverge — matching the "clone as sibling" action.
  const duplicateChild = (list: ChildKey, index: number) => {
    const arr = node[list] || [];
    const source = arr[index];
    const newList = [...arr];
    if (list !== 'variants' && source.type === 'item') {
      newList.splice(index + 1, 0, cloneNodeAsLink(source));
      onUpdate({ ...node, [list]: newList });
      return;
    }
    const clone = cloneNodeWithNewIds(source);
    newList.splice(index + 1, 0, clone);
    onUpdate({ ...node, [list]: newList });
    onSelect(clone);
  };

  // Bakes the mirrored source content into this node as an independent editable copy and
  // clears the link. Requires the node index to find the source.
  const handleUnlink = () => {
    if (!nodeIndex) return;
    const unlinked = unlinkNode(node, nodeIndex);
    onUpdate(unlinked);
    onSelect(unlinked);
  };

  // Adds an inline group (one <attachments>/<cargo> block) to the given list, optionally
  // linked to an exposed attachment slot so its members can be restricted to that slot.
  const handleAddGroup = (list: ChildKey, slot?: string) => {
    const newGroup: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'group',
      name: '',
      ...(slot ? { slot } : {}),
      chance: 1.0,
      attachments: [],
      cargo: [],
      isExpanded: true
    };
    onUpdate({
      ...node,
      [list]: [...(node[list] || []), newGroup],
      isExpanded: true
    });
    onSelect(newGroup);
    onNodeCreated?.(newGroup);
  };

  return (
    <div className="space-y-1" ref={setNodeRef} style={style}>
      <div 
        className={cx(
          "flex items-center group px-3 py-2 rounded-lg cursor-pointer border transition-all",
          isSelected 
            ? "bg-primary-50 border-primary-200 dark:bg-primary-900/20 dark:border-primary-800" 
            : "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700",
          editLocked && "opacity-60 grayscale-[0.5] cursor-default"
        )}
        onClick={() => { if (!editLocked) onSelect(node); }}
      >
        {!editLocked && (
          <div 
            {...attributes} 
            {...listeners}
            data-drag-handle="true"
            className="mr-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing"
            onContextMenu={(e) => {
              // Prevent context menu on the handle to allow right-click drag-and-copy
              e.preventDefault();
            }}
            onDragStart={(e) => e.preventDefault()}
          >
            <GripVertical size={16} pointerEvents="none" />
          </div>
        )}

        {canExpand ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (editLocked) {
                setLocalExpanded(!isExpanded);
              } else {
                onUpdate({ ...node, isExpanded: !isExpanded });
              }
            }}
            className="mr-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-400"
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          // Spacer keeps the icon/label aligned with expandable siblings.
          <div className="mr-2 p-1" aria-hidden><div className="size-4" /></div>
        )}

        <div className={cx(
          "p-1.5 rounded mr-3",
          displayNode.type === 'template' ? "bg-amber-100 text-amber-600"
            : isGroup ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400"
            : "bg-blue-100 text-blue-600"
        )}>
          {displayNode.type === 'template' ? <Layers size={14} /> : isGroup ? <Boxes size={14} /> : <Package size={14} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate text-sm">{displayNode.name || (displayNode.type === 'item' ? 'Unnamed Item' : isGroup ? 'Group' : 'Unnamed Template')}</span>
            <Badge color="gray" size="sm">{(displayNode.chance * 100).toFixed(0)}%</Badge>
            {displayNode.type === 'template' && <Badge color="warning" size="sm">Template</Badge>}
            {isGroup && <Badge color="purple" size="sm">Group{displayNode.slot ? ` · ${displayNode.slot}` : ''} · one of {(displayNode.attachments || []).length}</Badge>}
            {displayNode.type === 'item' && depth === 0 && (displayNode.variants?.length ?? 0) > 0 && (
              <Badge color="blue" size="sm">+{displayNode.variants!.length} variant{displayNode.variants!.length === 1 ? '' : 's'}</Badge>
            )}
            {(isReadOnly || isLinked) && <Badge color="gray" size="sm">Linked</Badge>}
          </div>
          {rootDisplayName && rootDisplayName !== node.name && (
            <span className="block truncate text-xs text-gray-400 dark:text-gray-500">{rootDisplayName}</span>
          )}
        </div>

        {/* Linked clones: an always-visible Unlink control (they have no edit buttons). */}
        {isLinked && !isReadOnly && (
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Unlink clone"
              title="Unlink to edit independently"
              onClick={(e) => { e.stopPropagation(); handleUnlink(); }}
            >
              <Unlink size={14} />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!editLocked && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={(e) => { e.stopPropagation(); onSelect(node); }}
              >
                <Settings2 size={14} />
              </Button>
              {displayNode.type === 'item' && onDuplicate && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                >
                  <Copy size={14} />
                </Button>
              )}
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

      {canExpand && isExpanded && (
        <div className="ml-6 pl-4 border-l-2 border-gray-100 dark:border-gray-800 space-y-4 py-2">
          {effectiveChildLists.map((listConfig) => {
             // Variants are authored directly on the node (never resolved from a template),
             // so read them straight from displayNode; other lists come from resolvedChildren.
             const children = listConfig.key === 'variants'
               ? (displayNode.variants || [])
               : (resolvedChildren[listConfig.key] || []);
             const offered = listOffered(listConfig);
             return (
              <div key={listConfig.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{listConfig.label}</span>
                  {!editLocked && offered && listConfig.key === 'variants' && (
                    <div className="flex gap-2">
                      <button
                        onClick={cloneItemToVariant}
                        title="Add a variant that is a copy of this item (Contents included)"
                        className="text-xs text-primary-600 hover:underline flex items-center"
                      >
                        <Copy size={12} className="mr-1" /> Clone from item
                      </button>
                      <button
                        onClick={() => handleAddChild('variants')}
                        className="text-xs text-primary-600 hover:underline flex items-center"
                      >
                        <Plus size={12} className="mr-1" /> Add
                      </button>
                    </div>
                  )}
                  {!editLocked && offered && listConfig.key !== 'variants' && (
                    <div className="flex gap-2">
                      {!isGroup && (
                        listConfig.key === 'attachments' && slotOptions.length > 0 ? (
                          // Link the new group to one of the parent's exposed slots, or create
                          // an unassigned (generic) group.
                          <Dropdown.Root>
                            <AriaButton className="text-xs text-purple-600 hover:underline flex items-center outline-none focus-visible:underline">
                              <Boxes size={12} className="mr-1" /> Group
                            </AriaButton>
                            <Dropdown.Popover>
                              <Dropdown.Menu
                                onAction={(key) => {
                                  if (key === UNASSIGNED_SLOT) handleAddGroup(listConfig.key);
                                  else handleAddGroup(listConfig.key, String(key));
                                }}
                              >
                                <Dropdown.Section>
                                  <Dropdown.SectionHeader className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                    Exposed slots
                                  </Dropdown.SectionHeader>
                                  {slotOptions.map(o => (
                                    <Dropdown.Item key={o.slot} id={o.slot} label={o.slot} addon={String(o.count)} />
                                  ))}
                                </Dropdown.Section>
                                <Dropdown.Separator />
                                <Dropdown.Item id={UNASSIGNED_SLOT} label="Unassigned group" icon={Boxes} />
                              </Dropdown.Menu>
                            </Dropdown.Popover>
                          </Dropdown.Root>
                        ) : (
                          <button
                            onClick={() => handleAddGroup(listConfig.key)}
                            className="text-xs text-purple-600 hover:underline flex items-center"
                          >
                            <Boxes size={12} className="mr-1" /> Group
                          </button>
                        )
                      )}
                      <button
                        onClick={() => onAddTemplate(listConfig.key as 'attachments' | 'cargo')}
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
                    <SortableContext items={children.map((c: LoadoutNode) => c.id)} strategy={verticalListSortingStrategy}>
                      {children.map((child: LoadoutNode, idx: number) => (
                        <HierarchicalNodeItem 
                          key={child.id}
                          node={child}
                          onUpdate={(updated) => updateChild(listConfig.key, idx, updated)}
                          onDelete={() => deleteChild(listConfig.key, idx)}
                          onDuplicate={() => duplicateChild(listConfig.key, idx)}
                          onSelect={onSelect}
                          onNodeCreated={onNodeCreated}
                          onAddTemplate={onAddTemplate}
                          selectedNodeId={selectedNodeId}
                          depth={depth + 1}
                          childLists={childLists}
                          allLoadouts={allLoadouts}
                          randomPresets={randomPresets}
                          expansionAirdrops={expansionAirdrops}
                          spawnableTypesByGroup={spawnableTypesByGroup}
                          isReadOnly={editLocked || displayNode.type === 'template'}
                          nodeIndex={nodeIndex}
                        />
                      ))}
                    </SortableContext>
                  </div>
                ) : offered ? (
                  <DroppablePlaceholder
                    id={`droppable:${node.id}:${listConfig.key}`}
                    label={listConfig.label}
                  />
                ) : (
                  <div className="text-[10px] text-gray-400 italic p-2">
                    {emptyNote(listConfig)}
                  </div>
                )}
              </div>
             );
          })}
        </div>
      )}
    </div>
  );
};
