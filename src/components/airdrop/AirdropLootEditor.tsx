import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/base/button/button';
import { Modal } from '@/components/base/modal/modal';
import { Input } from '@/components/base/input/input';
import { Plus, Package, PlusCircle, Settings01, SearchMd, AlertTriangle } from '@untitledui/icons';
import { HierarchicalTree } from '../hierarchical/HierarchicalTree';
import { ChildListConfig } from '../hierarchical/HierarchicalNodeItem';
import { HierarchicalProperties } from '../hierarchical/HierarchicalProperties';
import { loadoutToExpansionAirdrop, expansionAirdropToLoadout, nodeToStandaloneLoadout } from '@/utils/loadouts';
import { saveLoadout } from '@/utils/loadoutStore';
import { updateNodeInList, findNode } from '@/utils/tree';
import { LoadoutNode, Loadout } from '@/types/loadouts';

// Expansion airdrop loot (ExpansionLoot / ExpansionLootVariant) has no Cargo
// member — only Attachments. Restrict the tree to the attachments list so users
// can't author cargo that Expansion would silently ignore. gate:'either' offers the
// list for any item that accepts attachments OR holds cargo, since Expansion folds a
// container's cargo into attachments on spawn (ExpansionCreateInInventory) — so a
// cargo-only container (e.g. Bear_Pink) must still accept loot here.
const AIRDROP_CHILD_LISTS: ChildListConfig[] = [
  { key: 'attachments', label: 'Contents', icon: Settings01, gate: 'either' },
];

// Detect an attachment-level group: a `group` node sitting inside some node's
// attachments list (at any depth). Root-level groups map cleanly to Variants, but
// Expansion has no exclusive select-one primitive for attachments — a nested group
// gets flattened into independent attachment rolls on export, so warn the user.
const hasNestedGroup = (list: LoadoutNode[]): boolean =>
  (list || []).some(
    (n) => (n.attachments || []).some((c) => c.type === 'group') || hasNestedGroup(n.attachments || [])
  );

interface AirdropLootEditorProps {
  initialLoot: any[];
  onChange: (loot: any[]) => void;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  // Optional LoadoutNode-tree seed + change callback. Expansion's Loot[] format can't
  // represent linked clones (`linkedTo`) — they're materialized away on export — so a
  // consumer that persists in a Lootmaster-owned store (the Loot Lists sidecar) passes
  // the tree directly to keep links alive across remounts/reloads. When `initialNodes`
  // is given it seeds from the tree instead of re-deriving from `initialLoot`, and every
  // edit is emitted both as Expansion loot (`onChange`) and as the raw tree (`onChangeNodes`).
  initialNodes?: LoadoutNode[];
  onChangeNodes?: (nodes: LoadoutNode[]) => void;
}

/**
 * Self-contained loot editor for an Airdrop container or mission. Holds the
 * normalized LoadoutNode tree in local state (seeded once from `initialNodes` when
 * provided, else derived from `initialLoot`) so node ids stay stable across renders.
 * Remount via a `key` to reset for a different source. Converts back to Expansion loot
 * format on every change (and, when wired, also emits the raw tree via `onChangeNodes`).
 */
export const AirdropLootEditor: React.FC<AirdropLootEditorProps> = ({
  initialLoot,
  onChange,
  typeOptions,
  randomPresets,
  loadouts,
  initialNodes,
  onChangeNodes,
}) => {
  const [nodes, setNodes] = useState<LoadoutNode[]>(
    () => initialNodes ?? expansionAirdropToLoadout('loot', initialLoot || []).items
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<LoadoutNode | null>(null);
  // Set to a node id only when that node was just created, so the properties drawer focuses+selects
  // its classname input once. Cleared as soon as the drawer consumes it.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [templateTarget, setTemplateTarget] = useState<{ nodeId: string; list: 'attachments' | 'cargo' } | null>(null);
  const [loadoutPickerOpen, setLoadoutPickerOpen] = useState(false);
  const [loadoutSearch, setLoadoutSearch] = useState('');

  // The properties panel is a fixed-width drawer (HierarchicalProperties, w-[400px])
  // that scrolls its own body internally (its flex-1 overflow-auto region). We give the
  // sticky wrapper a DEFINITE height so that internal scroll engages; capping it with a
  // viewport-relative value (100vh - Xrem) is wrong because the host scroll container
  // starts well below the window top (editor header, tab nav, app chrome), so a viewport
  // value overshoots the visible area and the drawer's bottom is clipped where the parent
  // hides overflow — unreachable because the drawer is pinned. Instead we measure the
  // nearest scrollable ancestor and size the wrapper to its visible height, so the drawer
  // fits (and scrolls internally) regardless of how far down the page it sits.
  const rootRef = useRef<HTMLDivElement>(null);
  const [stickyHeight, setStickyHeight] = useState<string>('calc(100vh - 7rem)');
  useEffect(() => {
    let scrollParent: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (scrollParent) {
      const oy = getComputedStyle(scrollParent).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;
    const sp = scrollParent;
    // top-4 (1rem) sticky offset + 1rem bottom breathing room = 32px.
    const update = () => setStickyHeight(`${Math.max(240, sp.clientHeight - 32)}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sp);
    return () => ro.disconnect();
  }, []);

  const commit = (next: LoadoutNode[]) => {
    setNodes(next);
    const tempLoadout: Loadout = { id: 'temp', label: 'loot', items: next, updatedAt: Date.now() };
    onChange(loadoutToExpansionAirdrop(tempLoadout, loadouts, randomPresets?.presets));
    // Persist the raw tree too (with linkedTo) when the consumer keeps a node-tree store.
    onChangeNodes?.(next);
  };

  const handleUpdateNode = (updated: LoadoutNode) => {
    commit(updateNodeInList(nodes, updated));
    if (selectedNodeId === updated.id) setEditingNode(updated);
  };

  const addRootItem = () => {
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: 'NewItem',
      chance: 1.0,
      attachments: [],
      cargo: [],
    };
    commit([newNode, ...nodes]);
    setSelectedNodeId(newNode.id);
    setEditingNode(newNode);
    setPendingFocusId(newNode.id);
  };

  // Copy a saved loadout's items in as individual, editable loot entries. Round-trip
  // through the Expansion serializers (export then re-import) so the entries take the
  // exact airdrop-native shape: templates resolved, inline groups flattened, and cargo
  // folded into attachments (Expansion spawns children via ExpansionCreateInInventory,
  // so a container's cargo — e.g. a FirstAidKit's BandageDressing — becomes an
  // attachment). This guarantees the preview matches what will actually be exported.
  // It's a one-time copy (fresh ids), not a live link — later loadout edits won't propagate.
  const addLoadout = (loadout: Loadout) => {
    setLoadoutPickerOpen(false);
    const lootItems = loadoutToExpansionAirdrop(loadout, loadouts, randomPresets?.presets);
    const cloned = expansionAirdropToLoadout(loadout.label, lootItems).items;
    if (cloned.length === 0) return;
    commit([...cloned, ...nodes]);
    setSelectedNodeId(cloned[0].id);
    setEditingNode(cloned[0]);
  };

  const addTemplate = (source: 'preset' | 'loadout', name: string) => {
    if (!templateTarget) return;
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'template',
      templateSource: source,
      name,
      chance: 1.0,
      attachments: [],
      cargo: [],
    };
    const target = findNode(nodes, templateTarget.nodeId);
    if (target) {
      const updated = {
        ...target,
        [templateTarget.list]: [...(target[templateTarget.list] || []), newNode],
      };
      handleUpdateNode(updated);
    }
    setTemplateTarget(null);
  };

  return (
    <div ref={rootRef} className="flex gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Loot Contents</span>
          <div className="flex items-center gap-2">
            {loadouts.length > 0 && (
              <Button size="xs" variant="secondary-gray" icon={Package} onClick={() => { setLoadoutSearch(''); setLoadoutPickerOpen(true); }}>
                Add Loadout
              </Button>
            )}
            <Button size="xs" variant="secondary-gray" icon={Plus} onClick={addRootItem}>
              Add Item
            </Button>
          </div>
        </div>
        {hasNestedGroup(nodes) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 shrink-0" size={14} />
            <span>
              A select-one group is nested inside an item's attachments. Expansion airdrops have no
              exclusive attachment primitive, so its members will be flattened into independent
              attachment rolls (each rolled by its own chance) on export.
            </span>
          </div>
        )}
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-400">
            No loot configured. Add an item to begin.
          </div>
        ) : (
          <HierarchicalTree
            items={nodes}
            childLists={AIRDROP_CHILD_LISTS}
            allowRootDuplicate
            onUpdate={commit}
            onSelect={(node) => {
              setSelectedNodeId(node.id);
              setEditingNode(node);
            }}
            onNodeCreated={(node) => setPendingFocusId(node.id)}
            onAddTemplate={(nodeId, list) => setTemplateTarget({ nodeId, list })}
            selectedNodeId={selectedNodeId}
            randomPresets={randomPresets}
            allLoadouts={loadouts}
          />
        )}
      </div>

      {selectedNodeId && editingNode && (
        // self-start + sticky keeps the properties drawer in view while the (potentially long)
        // loot list scrolls in the host's overflow container. self-start stops the flex row from
        // stretching the drawer to the row's full height (which would defeat position:sticky).
        // Width matches the drawer (w-[400px]) so its right edge isn't clipped; the definite
        // height (stickyHeight, measured from the scroll container) lets the drawer scroll its
        // own body internally rather than overflowing the visible area.
        <div className="w-[400px] shrink-0 self-start sticky top-4" style={{ height: stickyHeight }}>
          <HierarchicalProperties
            node={editingNode}
            onUpdate={handleUpdateNode}
            onClose={() => setSelectedNodeId(null)}
            autoFocusNodeId={pendingFocusId}
            onAutoFocusConsumed={() => setPendingFocusId(null)}
            onExportAsLoadout={async (node) => {
              try {
                const lo = nodeToStandaloneLoadout(node, [node], loadouts);
                await saveLoadout(lo);
                alert(`Saved "${lo.label}" to the loadout library.`);
              } catch (e) {
                alert(`Failed to save loadout: ${e instanceof Error ? e.message : e}`);
              }
            }}
            typeOptions={typeOptions}
            availableTemplates={loadouts}
            randomPresets={randomPresets}
            config={{
              title: 'Airdrop Item Properties',
              showQuantity: true,
              showDamage: false,
              showVariants: true,
            }}
          />
        </div>
      )}

      {loadoutPickerOpen && (
        <Modal isOpen={loadoutPickerOpen} onClose={() => setLoadoutPickerOpen(false)} title="Add Loadout as Loot" maxWidth="max-w-md">
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              The loadout's items are copied in as individual loot entries you can edit. There is no live link back to the loadout.
            </p>
            <div className="relative">
              <SearchMd className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <Input
                placeholder="Search loadouts..."
                className="pl-9"
                value={loadoutSearch}
                onChange={(e) => setLoadoutSearch(e.target.value)}
                autoFocus
              />
            </div>
            {(() => {
              const q = loadoutSearch.trim().toLowerCase();
              const filtered = q ? loadouts.filter((l) => l.label.toLowerCase().includes(q)) : loadouts;
              if (filtered.length === 0) {
                return <p className="text-xs text-gray-400 py-4 text-center">No loadouts match "{loadoutSearch}".</p>;
              }
              return (
                <div className="grid grid-cols-1 gap-2 max-h-80 overflow-auto p-1">
                  {filtered.map((l) => {
                    const count = (l.items || []).length;
                    return (
                      <Button key={l.id} variant="secondary-gray" className="justify-start font-mono text-xs" icon={Package} onClick={() => addLoadout(l)}>
                        {l.label} · {count} item{count === 1 ? '' : 's'}
                      </Button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </Modal>
      )}

      {templateTarget && (
        <Modal isOpen={!!templateTarget} onClose={() => setTemplateTarget(null)} title="Select Template" maxWidth="max-w-md">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Random Presets</label>
              <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto p-1">
                {(randomPresets?.presets || []).map((p: any, i: number) => (
                  <Button key={i} variant="secondary-gray" className="justify-start font-mono text-xs" icon={PlusCircle} onClick={() => addTemplate('preset', p.name)}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
            {loadouts.length > 0 && (
              <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-2">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Saved Loadouts</label>
                <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto p-1">
                  {loadouts.map((l: any, i: number) => (
                    <Button key={i} variant="secondary-gray" className="justify-start font-mono text-xs" icon={Package} onClick={() => addTemplate('loadout', l.id)}>
                      {l.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
