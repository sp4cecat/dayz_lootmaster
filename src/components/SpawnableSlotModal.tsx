import React, { useState, useMemo } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Slider } from '@/components/base/slider/slider';
import { Toggle } from '@/components/base/toggle/toggle';
import { Plus, Trash2, Package, Layers, Settings2, Search } from 'lucide-react';
import { cx } from '@/utils/cx';
import { XMLNodeKind } from '@/types/xml';

interface SpawnableSlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  slot: any;
  onSave: (nextSlot: any) => void;
  presets: any[];
  typeOptions: string[];
  kind: XMLNodeKind.ATTACHMENTS | XMLNodeKind.CARGO;
  title?: string;
}

export const SpawnableSlotModal: React.FC<SpawnableSlotModalProps> = ({
  isOpen,
  onClose,
  slot,
  onSave,
  presets,
  typeOptions,
  kind,
  title
}) => {
  const [editedSlot, setEditedSlot] = useState(JSON.parse(JSON.stringify(slot || {
    kind,
    chance: 1.0,
    preset: '',
    attrs: { chance: '1.00' },
    items: []
  })));

  const [usePreset, setUsePreset] = useState(!!editedSlot.preset);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTypeOptions = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    const lower = searchTerm.toLowerCase();
    return typeOptions.filter(opt => opt.toLowerCase().includes(lower)).slice(0, 50);
  }, [searchTerm, typeOptions]);

  const handleChanceChange = (val: number) => {
    const chance = val / 100;
    setEditedSlot({
      ...editedSlot,
      chance,
      attrs: { ...editedSlot.attrs, chance: chance.toFixed(2) }
    });
  };

  const handleItemChanceChange = (idx: number, val: number) => {
    const chance = val / 100;
    const nextItems = [...editedSlot.items];
    nextItems[idx] = {
      ...nextItems[idx],
      chance,
      attrs: { ...nextItems[idx].attrs, chance: chance.toFixed(2) }
    };
    setEditedSlot({ ...editedSlot, items: nextItems });
  };

  const addItem = (name: string) => {
    setEditedSlot({
      ...editedSlot,
      items: [...editedSlot.items, {
        kind: XMLNodeKind.ITEM,
        name,
        chance: 1.0,
        attrs: { name, chance: '1.00' }
      }]
    });
    setSearchTerm('');
  };

  const removeItem = (idx: number) => {
    setEditedSlot({
      ...editedSlot,
      items: editedSlot.items.filter((_: any, i: number) => i !== idx)
    });
  };

  const handleSave = () => {
    const finalSlot = { ...editedSlot };
    if (usePreset) {
      finalSlot.items = [];
    } else {
      finalSlot.preset = '';
      finalSlot.attrs = { ...finalSlot.attrs };
      delete finalSlot.attrs.preset;
    }
    onSave(finalSlot);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || `Edit ${kind === XMLNodeKind.ATTACHMENTS ? 'Attachment Slot' : 'Cargo Item'}`}
      icon={kind === XMLNodeKind.ATTACHMENTS ? Settings2 : Package}
      maxWidth="max-w-3xl"
      footer={
        <>
          <Button variant="secondary-gray" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Apply Changes</Button>
        </>
      }
    >
      <div className="space-y-8">
        {/* Chance Section */}
        <section>
          <Slider
            label="Slot Spawn Probability"
            helperText="Likelihood of this slot being populated when the item spawns."
            value={Math.round(editedSlot.chance * 100)}
            onChange={handleChanceChange}
            minValue={0}
            maxValue={100}
            suffix="%"
          />
        </section>

        {/* Source Type Toggle */}
        <section className="p-4 bg-gray-50 dark:bg-gray-950/20 rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">Definition Source</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Choose between a random preset or a specific list of items.</p>
            </div>
            <Toggle 
              label={usePreset ? "Showing: Presets" : "Showing: Types"}
              isSelected={usePreset}
              onChange={setUsePreset}
            />
          </div>

          {usePreset ? (
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Select Preset</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {presets.length > 0 ? presets.map(p => (
                  <button
                    key={p.name}
                    onClick={() => setEditedSlot({ ...editedSlot, preset: p.name, attrs: { ...editedSlot.attrs, preset: p.name } })}
                    className={cx(
                      "px-3 py-2 text-sm rounded-lg border text-left transition-all",
                      editedSlot.preset === p.name
                        ? "bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300 font-bold shadow-sm"
                        : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400"
                    )}
                  >
                    {p.name}
                  </button>
                )) : (
                  <div className="col-span-full py-4 text-center text-xs text-gray-400 italic">
                    No random presets available.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="relative">
                <Input
                  label="Add Item to List"
                  placeholder="Search item name..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  icon={Search}
                />
                {filteredTypeOptions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg max-h-60 overflow-y-auto scrollbar-thin">
                    {filteredTypeOptions.map(opt => (
                      <button
                        key={opt}
                        onClick={() => addItem(opt)}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Configured Items</label>
                <div className="space-y-2">
                  {editedSlot.items?.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-4 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-sm">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{item.name}</p>
                      </div>
                      <Slider
                        className="w-48 px-4 border-l border-gray-100 dark:border-gray-800"
                        labelPosition="hidden"
                        value={Math.round(item.chance * 100)}
                        onChange={v => handleItemChanceChange(idx, v)}
                        minValue={0}
                        maxValue={100}
                      />
                      <div className="w-12 text-xs font-medium text-gray-500 text-right">
                        {Math.round(item.chance * 100)}%
                      </div>
                      <Button
                        size="sm"
                        variant="tertiary"
                        className="p-1.5 text-error-600 hover:text-error-700 hover:bg-error-50 dark:hover:bg-error-900/20"
                        onClick={() => removeItem(idx)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                  {(!editedSlot.items || editedSlot.items.length === 0) && (
                    <div className="py-8 text-center text-gray-400 italic text-sm">
                      No items added yet. Search and select above.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};
