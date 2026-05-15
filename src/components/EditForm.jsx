import React, { useState } from 'react';
import EditFormCLETab from './EditFormCLETab.jsx';
import EditFormMarketplaceTab from './EditFormMarketplaceTab.jsx';
import EditFormSpawnableTab from './EditFormSpawnableTab.jsx';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * Container EditForm that separates CLE and Marketplace states completely.
 * Only `selectedTypes` is shared between tabs. Marketplace loads lazily on first open,
 * and both tabs remain mounted to preserve their local state when inactive.
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
  // Wrap setter so function values are stored, not invoked as updaters
  const registerSaveHandler = React.useCallback((fn /** @type {null | (() => void)} */) => {
    setSaveCLE(() => fn);
  }, []);

  return (
    <div className="edit-form">
      <div className="edit-form-header">
        <h3>Edit {selectedTypes.length} item{selectedTypes.length > 1 ? 's' : ''}</h3>
        <div className="spacer" />
        {activeTab === 'CLE' && (
          <button type="button" className="btn primary" onClick={() => saveCLE && saveCLE()} disabled={!canSaveCLE || !saveCLE}>Save</button>
        )}
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>

      <div className="tabbar" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button type="button" className={`btn ${activeTab === 'CLE' ? 'primary' : ''}`} onClick={() => setActiveTab('CLE')}>CLE</button>
        <button type="button" className={`btn ${activeTab === 'Spawnable' ? 'primary' : ''}`} onClick={() => setActiveTab('Spawnable')}>Spawnable</button>
        <button type="button" className={`btn ${activeTab === 'Marketplace' ? 'primary' : ''}`} onClick={() => { setActiveTab('Marketplace'); if (!marketTabOpened) setMarketTabOpened(true); }}>marketplace</button>
      </div>

      {/* Keep tabs mounted; only show active via CSS */}
      <div style={{ display: activeTab === 'CLE' ? 'block' : 'none' }}>
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

      <div style={{ display: activeTab === 'Spawnable' ? 'block' : 'none' }}>
        <EditFormSpawnableTab
          selectedTypes={selectedTypes}
          spawnableTypesByGroup={spawnableTypesByGroup}
          setSpawnableTypesByGroup={setSpawnableTypesByGroup}
          randomPresets={randomPresets}
          globalsDefaults={globalsDefaults}
        />
      </div>

      {marketTabOpened && (
        <div style={{ display: activeTab === 'Marketplace' ? 'block' : 'none' }}>
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
  );
}