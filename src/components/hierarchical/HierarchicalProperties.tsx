import React from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { Input } from '@/components/base/input/input';
import { ComboBox, ComboBoxItem } from '@/components/base/combobox/combobox';
import { Slider } from '@/components/base/slider/slider';
import { X, Layers, Package, Plus, Trash2, Boxes } from 'lucide-react';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/button/button';
import { cx } from '@/utils/cx';
import { useCatalog } from '@/contexts/CatalogContext';

export interface HierarchicalPropertiesConfig {
  showQuantity?: boolean;
  showDamage?: boolean;
  showVariants?: boolean;
  showAttributes?: boolean;
  title?: string;
}

interface HierarchicalPropertiesProps {
  node: LoadoutNode;
  onUpdate: (updated: LoadoutNode) => void;
  onClose: () => void;
  typeOptions: string[];
  availableTemplates: Loadout[];
  config?: HierarchicalPropertiesConfig;

  /**
   * When this node sits in an attachments slot, the classes that can attach onto its
   * parent. Non-null + non-empty restricts the item picker to compatible attachments;
   * null/empty leaves the full typeOptions available (fallback when catalog can't answer).
   */
  compatibleClasses?: string[] | null;

  /**
   * For a group node: the exposed attachment slots of the group's parent item (from the
   * catalog attachments[] feed). Populates the "Linked slot" picker so members can be
   * restricted to a specific slot. Null/empty leaves the group generic.
   */
  groupSlotOptions?: { slot: string; count: number }[] | null;

  // For template resolution context (optional)
  randomPresets?: { presets: any[] };
  expansionAirdrops?: any;

  /**
   * Spawnable types keyed by group -> file -> { types: [{ name, sections }] }. Populates the
   * "Spawnable Type" option of the inline template-source picker. Optional; when absent, the
   * spawnable source shows an empty picker.
   */
  spawnableTypesByGroup?: Record<string, Record<string, any>>;
}

// The four sources a template node can live-link to. Order matches the import modal.
const TEMPLATE_SOURCES: { id: NonNullable<LoadoutNode['templateSource']>; label: string }[] = [
  { id: 'loadout', label: 'Saved Loadout' },
  { id: 'preset', label: 'Random Preset' },
  { id: 'airdrop', label: 'Expansion Airdrop' },
  { id: 'spawnable', label: 'Spawnable Type' },
];

// Sentinel option for clearing a group's linked slot back to a generic group.
const NO_SLOT = '__none__';

export const HierarchicalProperties: React.FC<HierarchicalPropertiesProps> = ({
  node,
  onUpdate,
  onClose,
  typeOptions,
  config = {
    showQuantity: true,
    showDamage: true,
    showVariants: false,
    showAttributes: false,
  },
  compatibleClasses,
  groupSlotOptions,
  availableTemplates,
  randomPresets,
  expansionAirdrops,
  spawnableTypesByGroup,
}) => {
  const { displayNameFor } = useCatalog();
  const [newVariant, setNewVariant] = React.useState('');

  // Picker options for the currently-selected template source. Each entry maps a display
  // label to the value stored in node.name — which is the loadout id for 'loadout' and the
  // source's own name for the other three (see resolveLoadoutNode in utils/loadouts.ts).
  const templateSource = node.templateSource ?? 'loadout';
  const templateItems = React.useMemo<{ id: string; name: string }[]>(() => {
    switch (templateSource) {
      case 'preset':
        return (randomPresets?.presets ?? []).map((p: any) => ({ id: p.name, name: p.name }));
      case 'airdrop':
        return (expansionAirdrops?.Containers ?? []).map((c: any) => ({ id: c.Container, name: c.Container }));
      case 'spawnable': {
        const seen = new Set<string>();
        const out: { id: string; name: string }[] = [];
        for (const files of Object.values(spawnableTypesByGroup ?? {})) {
          for (const data of Object.values(files as Record<string, any>)) {
            for (const t of (data?.types ?? [])) {
              if (t?.name && !seen.has(t.name)) {
                seen.add(t.name);
                out.push({ id: t.name, name: t.name });
              }
            }
          }
        }
        return out;
      }
      case 'loadout':
      default:
        return (availableTemplates ?? []).map(l => ({ id: l.id, name: l.label }));
    }
  }, [templateSource, availableTemplates, randomPresets, expansionAirdrops, spawnableTypesByGroup]);

  const slotComboItems = React.useMemo(() => {
    const opts = groupSlotOptions || [];
    return [
      { id: NO_SLOT, name: 'None (generic group)', count: -1 },
      ...opts.map(o => ({ id: o.slot, name: o.slot, count: o.count })),
    ];
  }, [groupSlotOptions]);

  const restricted = !!(compatibleClasses && compatibleClasses.length > 0);
  const itemOptions = React.useMemo(() => {
    const names = restricted ? compatibleClasses! : typeOptions;
    return names.map(n => ({ id: n, name: n, displayName: displayNameFor(n) || '' }));
  }, [restricted, compatibleClasses, typeOptions, displayNameFor]);

  const addVariant = () => {
    if (!newVariant) return;
    // Expansion expects variant objects, not bare strings, or its JSON loader drops them.
    const variants = [...(node.variants || []), { Name: newVariant, Chance: 1.0, Attachments: [] }];
    onUpdate({ ...node, variants });
    setNewVariant('');
  };

  const removeVariant = (index: number) => {
    const variants = [...(node.variants || [])];
    variants.splice(index, 1);
    onUpdate({ ...node, variants });
  };

  return (
    <div className="flex flex-col h-full shrink-0 min-h-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl w-[400px]">
      <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cx(
            "p-2 rounded-lg",
            node.type === 'template' ? "bg-amber-100 text-amber-600"
              : node.type === 'group' ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400"
              : "bg-blue-100 text-blue-600"
          )}>
            {node.type === 'template' ? <Layers size={18} /> : node.type === 'group' ? <Boxes size={18} /> : <Package size={18} />}
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white">{config.title || 'Item Properties'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Configure spawn settings</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-400">
          <X size={20} />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* Basic Config */}
        <section className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Node Type</label>
            <div className="flex gap-2">
              <button 
                onClick={() => onUpdate({ ...node, type: 'item' })}
                className={cx(
                  "flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all",
                  node.type === 'item' 
                    ? "bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400"
                )}
              >
                Item
              </button>
              <button 
                onClick={() => onUpdate({ ...node, type: 'group' })}
                className={cx(
                  "flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all",
                  node.type === 'group' 
                    ? "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400"
                )}
              >
                Group
              </button>
              <button
                onClick={() => onUpdate({
                  ...node,
                  type: 'template',
                  // Seed a usable source and drop the stale item classname on first conversion.
                  templateSource: node.templateSource ?? 'loadout',
                  name: node.type === 'template' ? node.name : '',
                })}
                className={cx(
                  "flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all",
                  node.type === 'template' 
                    ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400"
                )}
              >
                Template
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              {node.type === 'template' ? 'Select Template' : node.type === 'group' ? 'Group' : 'Item Classname'}
            </label>
            {node.type === 'group' ? (
              <div className="space-y-3">
                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-900/40 text-xs text-purple-800 dark:text-purple-200 space-y-1">
                  <p className="font-semibold">Attachment / Cargo Group</p>
                  <p className="text-purple-700/80 dark:text-purple-300/80">
                    The Spawn Chance below is the probability this group is rolled. When it is, one
                    member item is selected using the members' individual chances. Add members in the
                    tree's "Items" list.
                  </p>
                </div>

                {groupSlotOptions && groupSlotOptions.length > 0 ? (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Linked Slot</label>
                    <ComboBox
                      items={slotComboItems}
                      inputValue={node.slot || ''}
                      onInputChange={value => onUpdate({ ...node, slot: value || undefined })}
                      onSelectionChange={key => {
                        if (!key || key === NO_SLOT) onUpdate({ ...node, slot: undefined });
                        else onUpdate({ ...node, slot: key as string });
                      }}
                      placeholder="Search exposed slots..."
                      aria-label="Linked Slot"
                    >
                      {(item) => (
                        <ComboBoxItem id={item.id} textValue={item.name}>
                          <span className="flex items-center justify-between w-full gap-2">
                            <span>{item.name}</span>
                            {item.count >= 0 && <span className="text-xs text-gray-400">{item.count}</span>}
                          </span>
                        </ComboBoxItem>
                      )}
                    </ComboBox>
                    <p className="text-[11px] text-gray-400">
                      Restricts member items to those that fit this slot.
                    </p>
                  </div>
                ) : node.slot ? (
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">
                      Linked slot: <span className="font-mono text-gray-700 dark:text-gray-300">{node.slot}</span>
                    </span>
                    <button
                      onClick={() => onUpdate({ ...node, slot: undefined })}
                      className="text-gray-400 hover:text-error-600"
                      aria-label="Clear linked slot"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            ) : node.type === 'template' ? (
              <div className="space-y-3">
                {/* Source type: which kind of saved thing this template live-links to. */}
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATE_SOURCES.map(src => (
                    <button
                      key={src.id}
                      onClick={() => onUpdate({ ...node, templateSource: src.id, name: '' })}
                      className={cx(
                        "py-1.5 px-2 rounded-lg text-xs font-medium border transition-all",
                        templateSource === src.id
                          ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300"
                          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400"
                      )}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>

                {/* Target picker: the specific source to link to. Controlled selection (not
                    inputValue) so react-aria manages search text and node.name only holds a
                    committed id/name — never a partial search string. */}
                <ComboBox
                  items={templateItems}
                  selectedKey={node.name || null}
                  onSelectionChange={key => key && onUpdate({ ...node, name: key as string })}
                  placeholder={`Search ${TEMPLATE_SOURCES.find(s => s.id === templateSource)?.label.toLowerCase()}...`}
                  aria-label="Template source"
                >
                  {(item) => (
                    <ComboBoxItem id={item.id} textValue={item.name}>
                      <span>{item.name}</span>
                    </ComboBoxItem>
                  )}
                </ComboBox>

                {templateSource === 'airdrop' && (expansionAirdrops?.Containers ?? []).length === 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    No airdrop containers loaded. Open “+ Template → Expansion Airdrop” once to load airdrop settings.
                  </p>
                )}

                {node.name ? (
                  <Badge color="warning" size="md" className="w-full justify-center">
                    Live Linked: {TEMPLATE_SOURCES.find(s => s.id === templateSource)?.label}
                  </Badge>
                ) : (
                  <p className="text-[11px] text-gray-400">Select a source above to link this template.</p>
                )}

                <p className="text-[10px] text-gray-500 italic">
                  This node's children are dynamically loaded from the source template. Changes to the source will reflect here automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <ComboBox
                  items={itemOptions}
                  inputValue={node.name}
                  onInputChange={value => {
                    // Items carry a combined "Class DisplayName" textValue so display names are
                    // searchable, but on selection react-aria pushes that whole textValue into the
                    // input. Map it back to the bare class name (else `name` gets polluted with the
                    // display name and stops resolving in the catalog); free-typed text is stored as-is.
                    const match = itemOptions.find(o => `${o.name} ${o.displayName}`.trim() === value.trim());
                    onUpdate({ ...node, name: match ? match.name : value });
                  }}
                  onSelectionChange={key => key && onUpdate({ ...node, name: key as string })}
                  placeholder="Search classname..."
                  aria-label="Item Classname"
                >
                  {(item) => (
                    <ComboBoxItem id={item.id} textValue={`${item.name} ${item.displayName}`}>
                      <span className="flex flex-col">
                        <span>{item.name}</span>
                        {item.displayName && (
                          <span className="text-xs text-gray-400">{item.displayName}</span>
                        )}
                      </span>
                    </ComboBoxItem>
                  )}
                </ComboBox>
                {restricted && (
                  <p className="text-[11px] text-primary-600 dark:text-primary-400">
                    Showing {compatibleClasses!.length} compatible attachment{compatibleClasses!.length === 1 ? '' : 's'}.
                  </p>
                )}
                {displayNameFor(node.name) && (
                  <p className="text-[11px] text-gray-400">{displayNameFor(node.name)}</p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Probability */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Spawn Chance</label>
            <Badge color="brand" size="sm">{(node.chance * 100).toFixed(0)}%</Badge>
          </div>
          <Slider
            value={[node.chance * 100]}
            onChange={(v) => onUpdate({ ...node, chance: (Array.isArray(v) ? v[0] : v) / 100 })}
            minValue={0}
            maxValue={100}
            step={1}
          />
        </section>

        {/* Quantity Section */}
        {config.showQuantity && node.type === 'item' && (
          <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Quantity (Optional)</label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500">Min</span>
                <Input 
                  type="number" 
                  size="sm" 
                  value={node.quantity?.min ?? ''} 
                  onChange={e => onUpdate({ ...node, quantity: { ...node.quantity, min: parseInt(e.target.value) || 0, max: node.quantity?.max ?? 0, percent: node.quantity?.percent ?? -1 } })}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500">Max</span>
                <Input 
                  type="number" 
                  size="sm" 
                  value={node.quantity?.max ?? ''} 
                  onChange={e => onUpdate({ ...node, quantity: { ...node.quantity, max: parseInt(e.target.value) || 0, min: node.quantity?.min ?? 0, percent: node.quantity?.percent ?? -1 } })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-gray-500">Quantity Percent (-1 to disable)</span>
              <Input 
                type="number" 
                size="sm" 
                value={node.quantity?.percent ?? -1} 
                onChange={e => onUpdate({ ...node, quantity: { ...node.quantity, percent: parseFloat(e.target.value) || -1, min: node.quantity?.min ?? 0, max: node.quantity?.max ?? 0 } })}
              />
            </div>
          </section>
        )}

        {/* Damage Section */}
        {config.showDamage && node.type === 'item' && (
          <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Damage (Optional)</label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500">Min Damage (0.0 - 1.0)</span>
                <Input 
                  type="number" 
                  step="0.1" 
                  size="sm" 
                  value={node.damage?.min ?? ''} 
                  onChange={e => onUpdate({ ...node, damage: { ...node.damage, min: parseFloat(e.target.value) || 0, max: node.damage?.max ?? 0 } })}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500">Max Damage (0.0 - 1.0)</span>
                <Input 
                  type="number" 
                  step="0.1" 
                  size="sm" 
                  value={node.damage?.max ?? ''} 
                  onChange={e => onUpdate({ ...node, damage: { ...node.damage, max: parseFloat(e.target.value) || 0, min: node.damage?.min ?? 0 } })}
                />
              </div>
            </div>
          </section>
        )}

        {/* Variants Section (Expansion) */}
        {config.showVariants && node.type === 'item' && (
          <section className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Variants (Expansion)</label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input 
                  size="sm" 
                  placeholder="Variant classname..." 
                  value={newVariant}
                  onChange={e => setNewVariant(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addVariant()}
                />
                <Button size="sm" onClick={addVariant}><Plus size={16} /></Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(node.variants || []).map((v, i) => (
                  <Badge key={i} color="gray" className="pr-1 py-1">
                    {typeof v === 'string' ? v : v.Name}
                    <button onClick={() => removeVariant(i)} className="ml-1 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500">
                      <Trash2 size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
