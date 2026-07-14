import { useState, useCallback } from 'react';
import { useTabParam } from '@/hooks/useHashRoute';
import EditFormCLETab from './EditFormCLETab';
import EditFormMarketplaceTab from './EditFormMarketplaceTab';
import EditFormSpawnableTab from './EditFormSpawnableTab';
import { cx } from '@/utils/cx';
import { Button } from '@/components/base/button/button';
import { X, Save as SaveIcon } from 'lucide-react';
import type { Type } from '@/utils/xml';

interface EditFormProps {
  definitions: {
    categories: string[];
    usageflags: string[];
    valueflags: string[];
    tags: string[];
  };
  selectedTypes: Type[];
  onCancel: () => void;
  onSave: (apply: (t: Type) => Type) => void;
  typeOptions?: string[];
  typeOptionsByCategory?: Record<string, string[]>;
  selectedProfileId: string;
  selectedProfile?: { id: string; addons?: string[] };
  spawnableTypesByGroup?: Record<string, Record<string, any>>;
  setSpawnableTypesByGroup?: (next: any) => void;
  randomPresets?: { presets: any[] };
  globalsDefaults?: { LootDamageMin: number | null; LootDamageMax: number | null };
  loadouts?: any[];
}

export default function EditForm({ 
  definitions, 
  selectedTypes, 
  onCancel, 
  onSave, 
  typeOptions = [], 
  typeOptionsByCategory = {}, 
  selectedProfileId,
  selectedProfile,
  spawnableTypesByGroup = {},
  setSpawnableTypesByGroup = () => {}, 
  randomPresets = { presets: [] }, 
  globalsDefaults = { LootDamageMin: null, LootDamageMax: null },
  loadouts = []
}: EditFormProps) {
  const [activeTab, setActiveTab] = useTabParam<'CLE' | 'Spawnable' | 'Marketplace'>('CLE', ['CLE', 'Spawnable', 'Marketplace']);
  const [marketTabOpened, setMarketTabOpened] = useState(false);
  const [canSaveCLE, setCanSaveCLE] = useState(false);
  const [saveCLE, setSaveCLE] = useState<null | (() => void)>(null);
  
  const registerSaveHandler = useCallback((fn: null | (() => void)) => {
    setSaveCLE(() => fn);
  }, []);

  const tabs = [
    { id: 'CLE', label: 'Loot Economy' },
    { id: 'Spawnable', label: 'Spawnable / Cargo' },
    ...(selectedProfile?.addons?.includes('expansion') ? [{ id: 'Marketplace', label: 'Marketplace' }] : []),
  ] as { id: 'CLE' | 'Spawnable' | 'Marketplace'; label: string }[];

  const itemsText = selectedTypes.length === 1 ? '1 item' : `${selectedTypes.length} items`;

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 shrink-0 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/20">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-xl font-bold text-gray-900 tracking-tight dark:text-white">
              Edit {itemsText}
            </h3>
            <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Modify properties for selected types.</p>
          </div>
          <button 
            onClick={onCancel} 
            className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="flex items-center gap-3 mt-6">
          <Button 
              variant="primary"
              className="flex-1"
              onClick={() => saveCLE && saveCLE()} 
              disabled={activeTab !== 'CLE' || !canSaveCLE || !saveCLE}
              icon={SaveIcon}
              size="md"
          >
              Save CLE
          </Button>
          <Button variant="secondary-gray" onClick={onCancel} size="md">
            Cancel
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b border-gray-200 shrink-0 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex gap-8">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'Marketplace' && !marketTabOpened) setMarketTabOpened(true);
                }}
                className={cx(
                  "py-4 text-sm font-bold border-b-2 transition-all relative",
                  isActive 
                    ? "border-primary-600 text-primary-700 dark:border-primary-500 dark:text-primary-300" 
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-700"
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-600 dark:bg-primary-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin edit-form-content">
        {/* Keep tabs mounted; only show active via CSS */}
        <div className={cx(activeTab !== 'CLE' && "hidden")}>
          <EditFormCLETab
            definitions={definitions}
            selectedTypes={selectedTypes}
            onSave={onSave}
            onCanSaveChange={setCanSaveCLE}
            registerSaveHandler={registerSaveHandler}
            selectedProfileId={selectedProfileId}
            selectedProfile={selectedProfile}
          />
        </div>

        <div className={cx(activeTab !== 'Spawnable' && "hidden")}>
          <EditFormSpawnableTab
            selectedTypes={selectedTypes}
            spawnableTypesByGroup={spawnableTypesByGroup}
            setSpawnableTypesByGroup={setSpawnableTypesByGroup}
            randomPresets={randomPresets}
            globalsDefaults={globalsDefaults}
            typeOptions={typeOptions}
            loadouts={loadouts}
          />
        </div>

        {marketTabOpened && (
          <div className={cx(activeTab !== 'Marketplace' && "hidden")}>
            <EditFormMarketplaceTab
              selectedTypes={selectedTypes}
              typeOptions={typeOptions}
              typeOptionsByCategory={typeOptionsByCategory}
              activated={marketTabOpened}
              selectedProfileId={selectedProfileId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
