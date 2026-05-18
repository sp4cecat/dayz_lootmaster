import React, { useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Slider } from '@/components/base/slider/slider';
import { Plus, Trash2, Copy, Layers, Search, AlertTriangle } from 'lucide-react';
import { cx } from '@/utils/cx';

interface PresetItem {
  kind: string;
  name: string;
  chance: number | null;
  attrs: Record<string, string>;
}

interface Preset {
  kind: string;
  name: string;
  chance: number | null;
  attrs: Record<string, string>;
  items: PresetItem[];
}

interface RandomPresetsModalProps {
  onClose: () => void;
  randomPresets: { presets: Preset[] };
  setRandomPresets: (next: any) => void;
  spawnableTypesByGroup?: Record<string, any>;
  setSpawnableTypesByGroup?: (next: any) => void;
}

function chancePercent(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10 : 0;
}

function fromPercent(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0;
}

export const RandomPresetsModal: React.FC<RandomPresetsModalProps> = ({
  onClose,
  randomPresets,
  setRandomPresets,
  spawnableTypesByGroup = {},
  setSpawnableTypesByGroup = () => {}
}) => {
  const presets = randomPresets?.presets || [];
  const presetNames = new Set(presets.map(p => p.name).filter(Boolean));
  const [pendingDelete, setPendingDelete] = useState<{ index: number; name: string; refs: number } | null>(null);
  const [transferOnDelete, setTransferOnDelete] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const updatePreset = (index: number, apply: (p: Preset) => Preset) => {
    const nextPresets = [...presets];
    nextPresets[index] = apply(nextPresets[index]);
    setRandomPresets({ ...randomPresets, presets: nextPresets });
  };

  const renamePresetReferences = (oldName: string, newName: string) => {
    if (!oldName || !newName || oldName === newName) return;
    setSpawnableTypesByGroup((prev: any) => {
      const next = { ...prev };
      for (const group in next) {
        if (next[group]?.types) {
          next[group] = {
            ...next[group],
            types: next[group].types.map((type: any) => ({
              ...type,
              sections: (type.sections || []).map((section: any) => section.preset === oldName
                ? { ...section, preset: newName, attrs: { ...(section.attrs || {}), preset: newName } }
                : section)
            }))
          };
        }
      }
      return next;
    });
  };

  const transferPresetToReferences = (preset: Preset) => {
    if (!preset?.name) return;
    setSpawnableTypesByGroup((prev: any) => {
      const next = { ...prev };
      for (const group in next) {
        if (next[group]?.types) {
          next[group] = {
            ...next[group],
            types: next[group].types.map((type: any) => ({
              ...type,
              sections: (type.sections || []).map((section: any) => section.preset === preset.name
                ? {
                  ...section,
                  preset: '',
                  chance: preset.chance ?? section.chance,
                  attrs: { ...(section.attrs || {}), preset: '', chance: String(preset.chance ?? section.chance ?? '') },
                  items: (preset.items || []).map(item => ({ ...item, attrs: { ...(item.attrs || {}) } }))
                }
                : section)
            }))
          };
        }
      }
      return next;
    });
  };

  const countReferences = (name: string) => {
    let total = 0;
    for (const group in spawnableTypesByGroup) {
      const data = spawnableTypesByGroup[group];
      if (data?.types) {
        for (const type of data.types) {
          if (type.sections) {
            total += type.sections.filter((s: any) => s.preset === name).length;
          }
        }
      }
    }
    return total;
  };

  const addPreset = () => {
    let i = presets.length + 1;
    let name = `NewPreset${i}`;
    while (presetNames.has(name)) {
      i += 1;
      name = `NewPreset${i}`;
    }
    setRandomPresets({
      ...randomPresets,
      presets: [...presets, { kind: 'attachments', name, chance: 1, attrs: { name, chance: '1' }, items: [] }]
    });
  };

  const duplicatePreset = (preset: Preset) => {
    let i = 2;
    let name = `${preset.name}_copy`;
    while (presetNames.has(name)) {
      name = `${preset.name}_copy${i}`;
      i += 1;
    }
    setRandomPresets({
      ...randomPresets,
      presets: [...presets, { ...preset, name, attrs: { ...(preset.attrs || {}), name }, items: (preset.items || []).map(item => ({ ...item, attrs: { ...(item.attrs || {}) } })) }]
    });
  };

  const requestRemovePreset = (index: number) => {
    const preset = presets[index];
    const refs = countReferences(preset?.name || '');
    setPendingDelete({ index, name: preset?.name || '', refs });
    setTransferOnDelete(false);
  };

  const confirmRemovePreset = () => {
    if (!pendingDelete) return;
    const preset = presets[pendingDelete.index];
    if (!preset) {
      setPendingDelete(null);
      return;
    }
    if (pendingDelete.refs && transferOnDelete) transferPresetToReferences(preset);
    const nextPresets = presets.filter((_, i) => i !== pendingDelete.index);
    setRandomPresets({ ...randomPresets, presets: nextPresets });
    setPendingDelete(null);
    setTransferOnDelete(false);
  };

  const filteredPresets = searchTerm 
    ? presets.map((p, i) => ({ ...p, originalIndex: i })).filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : presets.map((p, i) => ({ ...p, originalIndex: i }));

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Random Loot Presets"
      description="Define groups of items that can be referenced by spawnable types configuration."
      icon={Layers}
      maxWidth="max-w-4xl"
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 max-w-sm">
            <Input
              placeholder="Search presets..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              icon={Search}
              size="sm"
            />
          </div>
          <Button variant="primary" size="sm" icon={Plus} onClick={addPreset}>
            Add Preset Group
          </Button>
        </div>

        {pendingDelete && (
          <div className="p-4 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-xl space-y-4">
            <div className="flex gap-3">
              <AlertTriangle className="text-error-600 shrink-0" size={20} />
              <div>
                <h4 className="text-sm font-bold text-error-900 dark:text-error-100">Delete preset “{pendingDelete.name}”?</h4>
                {pendingDelete.refs > 0 ? (
                  <div className="mt-2 space-y-3">
                    <p className="text-sm text-error-700 dark:text-error-300">
                      This preset is referenced by {pendingDelete.refs} entry/entries in spawnable types.
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="rounded border-error-300 text-error-600 focus:ring-error-500"
                        checked={transferOnDelete} 
                        onChange={e => setTransferOnDelete(e.target.checked)} 
                      />
                      <span className="text-xs text-error-800 dark:text-error-200">
                        Transfer this preset's items directly into referencing entries before deleting.
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="text-sm text-error-700 dark:text-error-300 mt-1">This preset is unused.</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary-gray" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="error" size="sm" onClick={confirmRemovePreset}>Delete Permanently</Button>
            </div>
          </div>
        )}

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
          {filteredPresets.map((preset) => {
            const index = preset.originalIndex;
            const refs = countReferences(preset.name);
            return (
              <div key={`${preset.kind}-${preset.name}-${index}`} className="p-5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <Input
                      label="Preset Name"
                      value={preset.name}
                      onChange={e => updatePreset(index, p => {
                        renamePresetReferences(p.name, e.target.value);
                        return { ...p, name: e.target.value, attrs: { ...(p.attrs || {}), name: e.target.value } };
                      })}
                      size="sm"
                    />
                    <Input
                      label="XML Node Kind"
                      value={preset.kind}
                      onChange={e => updatePreset(index, p => ({ ...p, kind: e.target.value || 'attachments' }))}
                      size="sm"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Badge color={refs > 0 ? 'blue' : 'gray'} size="sm">
                      {refs ? `${refs} reference${refs === 1 ? '' : 's'}` : 'unused'}
                    </Badge>
                    <Button variant="tertiary" size="sm" icon={Copy} className="p-2" onClick={() => duplicatePreset(preset)} />
                    <Button variant="tertiary" size="sm" icon={Trash2} className="p-2 text-error-600 hover:text-error-700" onClick={() => requestRemovePreset(index)} />
                  </div>
                </div>

                <Slider
                  label={`Group Chance (${chancePercent(preset.chance)}%)`}
                  value={chancePercent(preset.chance)}
                  onChange={v => updatePreset(index, p => ({ 
                    ...p, 
                    chance: fromPercent(v), 
                    attrs: { ...(p.attrs || {}), chance: String(fromPercent(v)) } 
                  }))}
                  minValue={0}
                  maxValue={100}
                  suffix="%"
                />

                <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-950/20 rounded-xl border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Preset Items</h5>
                    <Button variant="secondary-gray" size="xs" icon={Plus} onClick={() => updatePreset(index, p => ({ 
                      ...p, 
                      items: [...(p.items || []), { kind: 'item', name: '', chance: 1, attrs: { chance: '1' } }] 
                    }))}>
                      Add Item
                    </Button>
                  </div>
                  
                  <div className="space-y-2">
                    {preset.items.map((item, itemIndex) => (
                      <div key={itemIndex} className="flex items-center gap-3">
                        <input
                          className="w-20 px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded shadow-sm focus:ring-1 focus:ring-primary-500 outline-none"
                          value={item.kind || 'item'}
                          onChange={e => updatePreset(index, p => ({ 
                            ...p, 
                            items: (p.items || []).map((it, i) => i === itemIndex ? { ...it, kind: e.target.value || 'item' } : it) 
                          }))}
                        />
                        <input
                          className="flex-1 px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded shadow-sm focus:ring-1 focus:ring-primary-500 outline-none"
                          value={item.name}
                          placeholder="Item name..."
                          onChange={e => updatePreset(index, p => ({ 
                            ...p, 
                            items: (p.items || []).map((it, i) => i === itemIndex ? { ...it, name: e.target.value, attrs: { ...(it.attrs || {}), name: e.target.value } } : it) 
                          }))}
                        />
                        <div className="w-32">
                          <Slider
                            value={chancePercent(item.chance)}
                            onChange={v => updatePreset(index, p => ({ 
                              ...p, 
                              items: (p.items || []).map((it, i) => i === itemIndex ? { ...it, chance: fromPercent(v), attrs: { ...(it.attrs || {}), chance: String(fromPercent(v)) } } : it) 
                            }))}
                            minValue={0}
                            maxValue={100}
                            label=""
                          />
                        </div>
                        <span className="w-10 text-[10px] font-medium text-gray-500 text-right">{chancePercent(item.chance)}%</span>
                        <Button 
                          variant="tertiary" 
                          size="sm" 
                          icon={Trash2} 
                          className="p-1 text-gray-400 hover:text-error-600" 
                          onClick={() => updatePreset(index, p => ({ 
                            ...p, 
                            items: (p.items || []).filter((_, i) => i !== itemIndex) 
                          }))}
                        />
                      </div>
                    ))}
                    {preset.items.length === 0 && (
                      <div className="py-4 text-center text-xs text-gray-400 italic">No items in this preset.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredPresets.length === 0 && (
            <div className="py-20 text-center bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
              <Layers className="size-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">No presets found matching your search.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
