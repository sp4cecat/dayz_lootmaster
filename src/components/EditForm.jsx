import React, { useState, useCallback } from 'react';
import EditFormCLETab from './EditFormCLETab.jsx';
import EditFormMarketplaceTab from './EditFormMarketplaceTab.jsx';
import EditFormSpawnableTab from './EditFormSpawnableTab.jsx';
import { cn } from '../utils/cn';
import { Button } from './ui/Button';
import { X } from 'lucide-react';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * Container EditForm that separates CLE and Marketplace states completely.
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  selectedTypes: Type[],
 *  onCancel: () => void,
 *  onSave: (apply: (t: Type) => Type) => void,
 *  typeOptions?: string[],
 *  typeOptionsByCategory?: Record<string, string[]>,
 *  selectedProfileId: string,
 *  selectedProfile?: {id: string, addons?: string[]},
 *  getApiBase: () => string,
 *  spawnableTypesByGroup?: Record<string, any>,
 *  setSpawnableTypesByGroup?: (next: any) => void,
 *  randomPresets?: {presets: any[]},
 *  globalsDefaults?: {LootDamageMin: number|null, LootDamageMax: number|null}
 * }} props
 */
export default function EditForm({ definitions, selectedTypes, onCancel, onSave, typeOptions = [], typeOptionsByCategory = {}, selectedProfileId, selectedProfile, getApiBase, spawnableTypesByGroup = {}, setSpawnableTypesByGroup = () => {}, randomPresets = { presets: [] }, globalsDefaults = { LootDamageMin: null, LootDamageMax: null } }) {
  const [activeTab, setActiveTab] = useState('CLE');
  const [marketTabOpened, setMarketTabOpened] = useState(false);
  const [canSaveCLE, setCanSaveCLE] = useState(false);
  const [saveCLE, setSaveCLE] = useState(/** @type {null | (() => void)} */(null));
  
  const registerSaveHandler = useCallback((fn /** @type {null | (() => void)} */) => {
    setSaveCLE(() => fn);
  }, []);

  const tabs = [
    { id: 'CLE', label: 'CLE' },
    { id: 'Spawnable', label: 'Spawnable' },
    { id: 'Marketplace', label: 'Marketplace' },
  ];

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 dark:bg-gray-900">
      <div className="p-6 border-b border-gray-100 shrink-0 dark:border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xl font-bold text-gray-900 tracking-tight dark:text-white">
            Edit {selectedTypes.length} item{selectedTypes.length > 1 ? 's' : ''}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300">
            <X size={24} />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6 dark:text-gray-400">Modify common properties for selected items.</p>
        
        <div className="flex items-center gap-2">
          {activeTab === 'CLE' && (
            <Button 
                className="flex-1"
                onClick={() => saveCLE && saveCLE()} 
                disabled={!canSaveCLE || !saveCLE}
            >
                Save Changes
            </Button>
          )}
          <Button variant="secondary" className={activeTab === 'CLE' ? '' : 'flex-1'} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="px-6 border-b border-gray-100 shrink-0 dark:border-gray-800">
        <div className="flex gap-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'Marketplace' && !marketTabOpened) setMarketTabOpened(true);
              }}
              className={cn(
                "py-4 text-sm font-semibold border-b-2 transition-all",
                activeTab === tab.id 
                  ? "border-primary-600 text-primary-700 dark:border-primary-500 dark:text-primary-300" 
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-700"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin edit-form-content">
        {/* Keep tabs mounted; only show active via CSS */}
        <div className={cn(activeTab !== 'CLE' && "hidden")}>
          <EditFormCLETab
            definitions={definitions}
            selectedTypes={selectedTypes}
            onSave={onSave}
            onCanSaveChange={setCanSaveCLE}
            registerSaveHandler={registerSaveHandler}
            selectedProfileId={selectedProfileId}
            selectedProfile={selectedProfile}
            getApiBase={getApiBase}
          />
        </div>

        <div className={cn(activeTab !== 'Spawnable' && "hidden")}>
          <EditFormSpawnableTab
            selectedTypes={selectedTypes}
            spawnableTypesByGroup={spawnableTypesByGroup}
            setSpawnableTypesByGroup={setSpawnableTypesByGroup}
            randomPresets={randomPresets}
            globalsDefaults={globalsDefaults}
          />
        </div>

        {marketTabOpened && (
          <div className={cn(activeTab !== 'Marketplace' && "hidden")}>
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