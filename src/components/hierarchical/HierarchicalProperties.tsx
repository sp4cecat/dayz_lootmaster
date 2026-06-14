import React from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { Input } from '@/components/base/input/input';
import { ComboBox, ComboBoxItem } from '@/components/base/combobox/combobox';
import { Slider } from '@/components/base/slider/slider';
import { X, Layers, Package, Plus, Trash2, Boxes } from 'lucide-react';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/button/button';
import { cx } from '@/utils/cx';

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
  
  // For template resolution context (optional)
  randomPresets?: { presets: any[] };
  expansionAirdrops?: any;
}

export const HierarchicalProperties: React.FC<HierarchicalPropertiesProps> = ({
  node,
  onUpdate,
  onClose,
  typeOptions,
  availableTemplates,
  config = {
    showQuantity: true,
    showDamage: true,
    showVariants: false,
    showAttributes: false,
  },
  randomPresets,
  expansionAirdrops
}) => {
  const [newVariant, setNewVariant] = React.useState('');

  const addVariant = () => {
    if (!newVariant) return;
    const variants = [...(node.variants || []), newVariant];
    onUpdate({ ...node, variants });
    setNewVariant('');
  };

  const removeVariant = (index: number) => {
    const variants = [...(node.variants || [])];
    variants.splice(index, 1);
    onUpdate({ ...node, variants });
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl w-[400px]">
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
                onClick={() => onUpdate({ ...node, type: 'template' })}
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
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-900/40 text-xs text-purple-800 dark:text-purple-200 space-y-1">
                <p className="font-semibold">Attachment / Cargo Group</p>
                <p className="text-purple-700/80 dark:text-purple-300/80">
                  The Spawn Chance below is the probability this group is rolled. When it is, one
                  member item is selected using the members' individual chances. Add members in the
                  tree's "Items" list.
                </p>
              </div>
            ) : node.type === 'template' ? (
              <div className="space-y-3">
                <Badge color="warning" size="md" className="w-full justify-center">
                  Live Linked: {node.templateSource === 'preset' ? 'Random Preset' : node.templateSource === 'airdrop' ? 'Expansion Airdrop' : node.templateSource === 'spawnable' ? 'Spawnable Type' : 'Saved Loadout'}
                </Badge>
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 font-mono text-xs break-all">
                  {node.name}
                </div>
                <p className="text-[10px] text-gray-500 italic">
                  This node's children are dynamically loaded from the source template. Changes to the source will reflect here automatically.
                </p>
              </div>
            ) : (
              <ComboBox 
                items={typeOptions.map(opt => ({ id: opt, name: opt }))}
                inputValue={node.name}
                onInputChange={value => onUpdate({ ...node, name: value })}
                onSelectionChange={key => key && onUpdate({ ...node, name: key as string })}
                placeholder="Search classname..."
                aria-label="Item Classname"
              >
                {(item) => <ComboBoxItem id={item.id}>{item.name}</ComboBoxItem>}
              </ComboBox>
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
            onValueChange={([val]) => onUpdate({ ...node, chance: val / 100 })}
            min={0}
            max={100}
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
                    {v}
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
