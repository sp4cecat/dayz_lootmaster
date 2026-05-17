import React from 'react';
import { ROOT_SPAWNABLE_GROUP, findSpawnableEntryForType } from '@/utils/xml';
import { Slider } from '@/components/base/slider/slider';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Plus, Trash2, Settings2, Sparkles, Percent, AlertCircle, X, ChevronRight } from 'lucide-react';
import type { Type } from '@/utils/xml';

interface EditFormSpawnableTabProps {
  selectedTypes: Type[];
  spawnableTypesByGroup: Record<string, any>;
  setSpawnableTypesByGroup: (next: any) => void;
  randomPresets: { presets: any[] };
  globalsDefaults: { LootDamageMin: number | null; LootDamageMax: number | null };
}

function chancePercent(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10 : 0;
}

export default function EditFormSpawnableTab({ 
  selectedTypes, 
  spawnableTypesByGroup, 
  setSpawnableTypesByGroup,
  randomPresets,
  globalsDefaults
}: EditFormSpawnableTabProps) {
  const isMulti = selectedTypes.length > 1;

  if (isMulti) {
    return (
      <div className="p-12 text-center bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
        <div className="size-16 bg-white dark:bg-gray-900 rounded-2xl flex items-center justify-center text-gray-400 mx-auto mb-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <Settings2 size={32} />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Multi-Item Editing Not Supported</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Spawnable and cargo configuration is currently only available for single-item selection to ensure configuration accuracy.
        </p>
      </div>
    );
  }

  const type = selectedTypes[0];
  const entry = findSpawnableEntryForType(type.name, spawnableTypesByGroup);

  if (!entry) {
    return (
      <div className="p-12 text-center bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
        <div className="size-16 bg-white dark:bg-gray-900 rounded-2xl flex items-center justify-center text-gray-400 mx-auto mb-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <Sparkles size={32} />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">No Spawnable Entry</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          This item doesn't have a configuration in cfgspawnabletypes.xml. Create one to manage its cargo and attachments.
        </p>
        <Button onClick={() => {}} icon={Plus}>Create Spawnable Entry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Damage Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Badge color="brand" size="sm" type="modern">Item Condition</Badge>
        </div>
        <div className="grid grid-cols-2 gap-6 bg-gray-50 dark:bg-gray-950/20 p-6 rounded-xl border border-gray-100 dark:border-gray-800">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Min Damage</label>
              <span className="text-xs font-mono font-bold text-primary-600 dark:text-primary-400">{chancePercent(entry.damage?.min ?? globalsDefaults.LootDamageMin)}%</span>
            </div>
            <Slider 
              value={[chancePercent(entry.damage?.min ?? globalsDefaults.LootDamageMin)]} 
              max={100} 
              step={1}
              onValueChange={() => {}}
            />
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Max Damage</label>
              <span className="text-xs font-mono font-bold text-primary-600 dark:text-primary-400">{chancePercent(entry.damage?.max ?? globalsDefaults.LootDamageMax)}%</span>
            </div>
            <Slider 
              value={[chancePercent(entry.damage?.max ?? globalsDefaults.LootDamageMax)]} 
              max={100} 
              step={1}
              onValueChange={() => {}}
            />
          </div>
        </div>
      </section>

      {/* Attachments Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge color="brand" size="sm" type="modern">Attachments</Badge>
            <span className="text-xs text-gray-400 font-medium">({entry.attachments?.length || 0} slots)</span>
          </div>
          <Button size="sm" variant="secondary-gray" icon={Plus}>Add Slot</Button>
        </div>
        
        <div className="space-y-3">
          {entry.attachments?.map((slot: any, idx: number) => (
            <div key={idx} className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm group hover:border-primary-300 dark:hover:border-primary-800 transition-all">
              <div className="size-10 bg-gray-50 dark:bg-gray-950 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                <Settings2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate">Slot {idx + 1}</p>
                  <Badge color="gray" size="sm">{chancePercent(slot.chance)}% Chance</Badge>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {slot.items?.length || 0} possible items in this slot
                </p>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="sm" variant="tertiary" className="p-2"><ChevronRight size={18} /></Button>
                <Button size="sm" variant="tertiary" className="p-2 text-error-600 hover:text-error-700 hover:bg-error-50 dark:hover:bg-error-900/20"><Trash2 size={18} /></Button>
              </div>
            </div>
          ))}
          {!entry.attachments?.length && (
            <div className="py-8 text-center text-gray-400 italic bg-gray-50/50 dark:bg-gray-950/10 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
              No attachment slots configured
            </div>
          )}
        </div>
      </section>

      {/* Cargo Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge color="brand" size="sm" type="modern">Cargo</Badge>
            <span className="text-xs text-gray-400 font-medium">({entry.cargo?.length || 0} items)</span>
          </div>
          <Button size="sm" variant="secondary-gray" icon={Plus}>Add Cargo</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entry.cargo?.map((item: any, idx: number) => (
            <div key={idx} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm group hover:border-primary-300 dark:hover:border-primary-800 transition-all">
              <div className="size-8 bg-gray-50 dark:bg-gray-950 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                <Percent size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">Cargo Item {idx + 1}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{chancePercent(item.chance)}% chance</p>
              </div>
              <Button size="sm" variant="tertiary" className="p-1.5 text-error-600 hover:text-error-700 hover:bg-error-50 dark:hover:bg-error-900/20 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          {!entry.cargo?.length && (
            <div className="col-span-2 py-8 text-center text-gray-400 italic bg-gray-50/50 dark:bg-gray-950/10 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
              No cargo configured
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
