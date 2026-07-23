import React, { useEffect, useMemo, useState } from 'react';
import { useTabParam } from '@/hooks/useHashRoute';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Toggle } from '@/components/base/toggle/toggle';
import { Select } from '@/components/base/select/select';
import {
  Save01, RefreshCcw01, Plus, Trash01, Copy01, CheckCircle, AlertCircle,
  Building07, Home02, MarkerPin01, Map01,
} from '@untitledui/icons';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
import { useMapMetadata } from '@/hooks/useMapMetadata';
import { AirdropDropLocationMap, DropLocation } from './AirdropDropLocationMap';
import { ItemChipGrid } from './expansion/ItemChipGrid';
import {
  DEFAULT_TERRITORY, DEFAULT_BASEBUILDING, TERRITORY_VERSION, BASEBUILDING_VERSION,
  stampVersion, zoneToDrop, applyDropToZone, BuildZone,
} from '@/utils/expansionBases';

interface ExpansionBasesEditorProps {
  selectedProfileId: string;
  typeOptions: string[];
  missionName?: string;
}

type SaveState = { kind: 'idle' | 'saving' | 'ok' | 'error'; message?: string };
type TabId = 'territory' | 'basebuilding' | 'zones';

// ---- Field metadata -------------------------------------------------------

type BoolField = { key: string; label: string; hint?: string };
type NumField = { key: string; label: string; suffix?: string; hint?: string; step?: number };
type EnumField = { key: string; label: string; hint?: string; options: { value: string; label: string }[] };

const TERRITORY_BOOL: BoolField[] = [
  { key: 'EnableTerritories', label: 'Enable Territories', hint: 'Off = vanilla flags only.' },
  { key: 'UseWholeMapForInviteList', label: 'Whole-map invite list', hint: 'Off = nearby players only.' },
  { key: 'AuthenticateCodeLockIfTerritoryMember', label: 'Auto-authenticate members on codelocks' },
  { key: 'OnlyInviteGroupMember', label: 'Only invite group members' },
];
const TERRITORY_NUM: NumField[] = [
  { key: 'TerritorySize', label: 'Territory size', suffix: 'm', step: 1 },
  { key: 'TerritoryPerimeterSize', label: 'Perimeter size', suffix: 'm', step: 1, hint: 'Match or exceed size to prevent overlaps.' },
  { key: 'TerritoryInviteAcceptRadius', label: 'Invite accept radius', suffix: 'm', step: 0.5 },
  { key: 'MaxMembersInTerritory', label: 'Max members', hint: '≤0 = unlimited.' },
  { key: 'MaxTerritoryPerPlayer', label: 'Max territories / player', hint: '≤0 = unlimited.' },
  { key: 'InviteCooldown', label: 'Invite cooldown', suffix: 'sec' },
  { key: 'MaxCodeLocksOnBBPerTerritory', label: 'Max codelocks on base parts', hint: '-1 = unlimited.' },
  { key: 'MaxCodeLocksOnItemsPerTerritory', label: 'Max codelocks on items', hint: '-1 = unlimited.' },
];

const BB_BOOL: BoolField[] = [
  { key: 'CanBuildAnywhere', label: 'Can build anywhere', hint: 'On = unrestricted deployment/building.' },
  { key: 'AllowBuildingWithoutATerritory', label: 'Allow building without a territory' },
  { key: 'CanCraftVanillaBasebuilding', label: 'Can craft vanilla base building' },
  { key: 'CanCraftExpansionBasebuilding', label: 'Can craft Expansion base building' },
  { key: 'CanCraftTerritoryFlagKit', label: 'Can craft territory flag kit' },
  { key: 'SimpleTerritory', label: 'Simple territory (auto-construct flag)' },
  { key: 'AutomaticFlagOnCreation', label: 'Automatic flag on creation' },
  { key: 'GetTerritoryFlagKitAfterBuild', label: 'Return flag kit after build' },
  { key: 'DestroyFlagOnDismantle', label: 'Destroy flag kit on dismantle' },
  { key: 'DismantleOutsideTerritory', label: 'Allow dismantle outside own territory' },
  { key: 'DismantleInsideTerritory', label: 'Allow dismantle inside others’ territory' },
  { key: 'DismantleAnywhere', label: 'Dismantle from any direction' },
  { key: 'CodelockActionsAnywhere', label: 'Codelock actions by proximity' },
  { key: 'DoDamageWhenEnterWrongCodeLock', label: 'Damage on wrong codelock entry' },
  { key: 'RememberCode', label: 'Remember code' },
  { key: 'PreventItemAccessThroughObstructingItems', label: 'Prevent item access through obstructions' },
  { key: 'EnableVirtualStorage', label: 'Enable virtual storage', hint: 'Moves container contents to virtual storage on close.' },
];
const BB_NUM: NumField[] = [
  { key: 'CodeLockLength', label: 'Codelock length', hint: 'Digits, e.g. 6.' },
  { key: 'DamageWhenEnterWrongCodeLock', label: 'Wrong-code damage', hint: '0–100 (100 = lethal).', step: 1 },
];
const BB_ENUM: EnumField[] = [
  {
    key: 'CodelockAttachMode', label: 'Codelock attach mode', options: [
      { value: '0', label: 'Expansion only' },
      { value: '1', label: 'Expansion + fence' },
      { value: '2', label: 'Expansion + fence + tents' },
      { value: '3', label: 'Expansion + tents' },
    ],
  },
  {
    key: 'DismantleFlagMode', label: 'Dismantle flag mode', options: [
      { value: '-1', label: 'Members only (bare hands)' },
      { value: '0', label: 'Anyone (bare hands)' },
      { value: '1', label: 'Anyone (specific tools)' },
    ],
  },
  {
    key: 'FlagMenuMode', label: 'Flag menu mode', options: [
      { value: '0', label: 'Disabled' },
      { value: '1', label: 'Full territory creation' },
      { value: '2', label: 'Creation without customization' },
    ],
  },
];

// ---- Component ------------------------------------------------------------

export const ExpansionBasesEditor: React.FC<ExpansionBasesEditorProps> = ({
  selectedProfileId, typeOptions, missionName,
}) => {
  const map = useMapMetadata(missionName);
  const [tab, setTab] = useTabParam<TabId>('territory', ['territory', 'basebuilding', 'zones']);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const [territory, setTerritory] = useState<any>(null);
  const [savedTerritory, setSavedTerritory] = useState<any>(null);
  const [baseBuilding, setBaseBuilding] = useState<any>(null);
  const [savedBaseBuilding, setSavedBaseBuilding] = useState<any>(null);
  const [selectedZoneIdx, setSelectedZoneIdx] = useState<number | null>(null);

  const load = async () => {
    if (!selectedProfileId) return;
    setLoading(true);
    try {
      const [tRes, bRes] = await Promise.all([
        apiFetch('/api/expansion/territory-settings', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/basebuilding-settings', { profileId: selectedProfileId }),
      ]);
      if (tRes.ok) {
        const data = await tRes.json();
        setTerritory(data); setSavedTerritory(data);
      } else {
        const fb = { ...DEFAULT_TERRITORY };
        setTerritory(fb); setSavedTerritory(fb);
      }
      if (bRes.ok) {
        const data = await bRes.json();
        if (!Array.isArray(data.Zones)) data.Zones = [];
        setBaseBuilding(data); setSavedBaseBuilding(data);
      } else {
        const fb = { ...DEFAULT_BASEBUILDING };
        setBaseBuilding(fb); setSavedBaseBuilding(fb);
      }
    } catch (e) {
      console.error('Failed to load bases & territories data', e);
      setSaveState({ kind: 'error', message: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setSelectedZoneIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  const territoryDirty = useMemo(
    () => JSON.stringify(territory) !== JSON.stringify(savedTerritory),
    [territory, savedTerritory]);
  const baseBuildingDirty = useMemo(
    () => JSON.stringify(baseBuilding) !== JSON.stringify(savedBaseBuilding),
    [baseBuilding, savedBaseBuilding]);

  const flash = (kind: SaveState['kind'], message?: string) => {
    setSaveState({ kind, message });
    if (kind === 'ok') setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
  };

  const saveTerritory = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch('/api/expansion/territory-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, profileId: selectedProfileId,
        body: JSON.stringify(stampVersion(territory, TERRITORY_VERSION)),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setSavedTerritory(territory); flash('ok');
    } catch (e: any) { flash('error', e.message); }
  };

  const saveBaseBuilding = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch('/api/expansion/basebuilding-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, profileId: selectedProfileId,
        body: JSON.stringify(stampVersion(baseBuilding, BASEBUILDING_VERSION)),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setSavedBaseBuilding(baseBuilding); flash('ok');
    } catch (e: any) { flash('error', e.message); }
  };

  const setT = (key: string, value: any) => setTerritory({ ...territory, [key]: value });
  const setB = (key: string, value: any) => setBaseBuilding({ ...baseBuilding, [key]: value });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-gray-950">
      <header className="px-6 pt-5 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Bases &amp; Territories</h1>
            <p className="text-xs text-gray-500">Configure Expansion territory and base-building rules</p>
          </div>
          <div className="flex items-center gap-3">
            {saveState.kind === 'ok' && (
              <span className="flex items-center gap-1.5 text-sm text-success-600"><CheckCircle size={16} /> Saved</span>
            )}
            {saveState.kind === 'error' && (
              <span className="flex items-center gap-1.5 text-sm text-error-600"><AlertCircle size={16} /> {saveState.message}</span>
            )}
            <Button size="sm" variant="secondary-gray" icon={RefreshCcw01} onClick={load} disabled={loading}>Reload</Button>
          </div>
        </div>
        <nav className="flex gap-1 mt-4">
          {([['territory', 'Territory', Home02], ['basebuilding', 'Base Building', Building07], ['zones', 'Zones', Map01]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
                tab === id
                  ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
      </header>

      {loading && !territory ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCcw01 className="animate-spin text-primary-600" size={32} />
        </div>
      ) : tab === 'territory' ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Territory Settings</h3>
                <p className="text-sm text-gray-500">Server-global. Stored in <code>Profiles/ExpansionMod/Settings/TerritorySettings.json</code>.</p>
              </div>
              <Button variant="primary" icon={Save01} onClick={saveTerritory} disabled={!territoryDirty}>Save Territory</Button>
            </div>
            <div className="p-4 space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
              {TERRITORY_BOOL.map(({ key, label, hint }) => (
                <Toggle key={key} label={label} hint={hint} isSelected={!!territory?.[key]} onChange={(v) => setT(key, v ? 1 : 0)} />
              ))}
              <div className="grid grid-cols-2 gap-4 pt-2">
                {TERRITORY_NUM.map(({ key, label, suffix, hint, step }) => (
                  <Input key={key} size="sm" label={label} type="number" suffix={suffix} hint={hint} step={step}
                    value={territory?.[key] ?? ''} onChange={(e) => setT(key, Number(e.target.value))} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : tab === 'basebuilding' ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Base Building Settings</h3>
                <p className="text-sm text-gray-500">Per-map. Stored in <code>mpmissions/&lt;map&gt;/expansion/settings/BaseBuildingSettings.json</code>.</p>
              </div>
              <Button variant="primary" icon={Save01} onClick={saveBaseBuilding} disabled={!baseBuildingDirty}>Save Base Building</Button>
            </div>

            {/* Deployable lists */}
            <div className="p-4 space-y-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
              <ItemChipGrid
                label="Deployable outside a territory"
                hint="Items players may deploy outside any territory (used only when building without a territory is disabled)."
                values={baseBuilding?.DeployableOutsideATerritory ?? []}
                onChange={(v) => setB('DeployableOutsideATerritory', v)}
                typeOptions={typeOptions}
                deployableOnly
              />
              <ItemChipGrid
                label="Deployable inside an enemy territory"
                hint="Raiding devices/traps players may deploy inside enemy territories."
                values={baseBuilding?.DeployableInsideAEnemyTerritory ?? []}
                onChange={(v) => setB('DeployableInsideAEnemyTerritory', v)}
                typeOptions={typeOptions}
                deployableOnly
              />
            </div>

            {/* Rules */}
            <div className="p-4 space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
              {BB_BOOL.map(({ key, label, hint }) => (
                <Toggle key={key} label={label} hint={hint} isSelected={!!baseBuilding?.[key]} onChange={(v) => setB(key, v ? 1 : 0)} />
              ))}
              <div className="grid grid-cols-2 gap-4 pt-2">
                {BB_NUM.map(({ key, label, suffix, hint, step }) => (
                  <Input key={key} size="sm" label={label} type="number" suffix={suffix} hint={hint} step={step}
                    value={baseBuilding?.[key] ?? ''} onChange={(e) => setB(key, Number(e.target.value))} />
                ))}
                {BB_ENUM.map(({ key, label, options, hint }) => (
                  <Select key={key} size="sm" label={label} hint={hint}
                    value={String(baseBuilding?.[key] ?? options[0].value)}
                    options={options}
                    onChange={(e) => setB(key, Number(e.target.value))} />
                ))}
              </div>
              <Input size="sm" label="No-build custom message"
                value={baseBuilding?.BuildZoneRequiredCustomMessage ?? ''}
                onChange={(e) => setB('BuildZoneRequiredCustomMessage', e.target.value)} />
            </div>

            {/* Virtual storage exclusions */}
            <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
              <ItemChipGrid
                label="Virtual storage excluded containers"
                hint="Container classnames exempt from the virtual storage system."
                values={baseBuilding?.VirtualStorageExcludedContainers ?? []}
                onChange={(v) => setB('VirtualStorageExcludedContainers', v)}
                typeOptions={typeOptions}
              />
            </div>
          </div>
        </div>
      ) : (
        <ZonesTab
          baseBuilding={baseBuilding}
          setBaseBuilding={setBaseBuilding}
          dirty={baseBuildingDirty}
          onSave={saveBaseBuilding}
          selectedZoneIdx={selectedZoneIdx}
          setSelectedZoneIdx={setSelectedZoneIdx}
          map={map}
          typeOptions={typeOptions}
        />
      )}
    </div>
  );
};

// ---- Zones tab ------------------------------------------------------------

interface ZonesTabProps {
  baseBuilding: any;
  setBaseBuilding: (b: any) => void;
  dirty: boolean;
  onSave: () => void;
  selectedZoneIdx: number | null;
  setSelectedZoneIdx: (i: number | null) => void;
  map: ReturnType<typeof useMapMetadata>;
  typeOptions: string[];
}

const ZonesTab: React.FC<ZonesTabProps> = ({
  baseBuilding, setBaseBuilding, dirty, onSave, selectedZoneIdx, setSelectedZoneIdx, map, typeOptions,
}) => {
  const zones: BuildZone[] = useMemo(
    () => (Array.isArray(baseBuilding?.Zones) ? baseBuilding.Zones : []),
    [baseBuilding?.Zones]);
  const selected = selectedZoneIdx !== null ? zones[selectedZoneIdx] : null;
  const noBuild = !!baseBuilding?.ZonesAreNoBuildZones;

  const setZones = (next: BuildZone[]) => setBaseBuilding({ ...baseBuilding, Zones: next });

  const drops: DropLocation[] = useMemo(() => zones.map(zoneToDrop), [zones]);

  const handleMapChange = (next: DropLocation[]) => {
    setZones(next.map((d, i) => applyDropToZone(zones[i], d)));
  };

  const updateZone = (patch: Partial<BuildZone>) => {
    if (selectedZoneIdx === null) return;
    setZones(zones.map((z, i) => (i === selectedZoneIdx ? { ...z, ...patch } : z)));
  };

  const addZone = () => {
    const z: BuildZone = {
      Name: `Zone ${zones.length + 1}`,
      Center: [Math.round(map.worldSize / 2), 0, Math.round(map.worldSize / 2)],
      Radius: 500, Items: [], IsWhitelist: 1, CustomMessage: '',
    };
    setZones([...zones, z]);
    setSelectedZoneIdx(zones.length);
  };

  const duplicateZone = (idx: number) => {
    const src = zones[idx];
    setZones([...zones, { ...src, Name: `${src.Name} Copy`, Center: [...src.Center] as [number, number, number], Items: [...src.Items] }]);
    setSelectedZoneIdx(zones.length);
  };

  const deleteZone = (idx: number) => {
    setZones(zones.filter((_, i) => i !== idx));
    const nextIdx = selectedZoneIdx === null || selectedZoneIdx === idx ? null
      : selectedZoneIdx > idx ? selectedZoneIdx - 1 : selectedZoneIdx;
    setSelectedZoneIdx(nextIdx);
  };

  const editorPanel = selected ? (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 space-y-3">
      <Input label="Zone name" value={selected.Name}
        onChange={(e) => updateZone({ Name: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <Input size="sm" label="X" type="number" value={Math.round(selected.Center?.[0] ?? 0)}
          onChange={(e) => updateZone({ Center: [Number(e.target.value), 0, selected.Center?.[2] ?? 0] })} />
        <Input size="sm" label="Z" type="number" value={Math.round(selected.Center?.[2] ?? 0)}
          onChange={(e) => updateZone({ Center: [selected.Center?.[0] ?? 0, 0, Number(e.target.value)] })} />
        <Input size="sm" label="Radius" type="number" value={Math.round(selected.Radius || 0)}
          onChange={(e) => updateZone({ Radius: Number(e.target.value) })} />
      </div>
      <Toggle label="Is whitelist" hint="On = only these items may be built/placed here; off = these items are blocked."
        isSelected={!!selected.IsWhitelist} onChange={(v) => updateZone({ IsWhitelist: v ? 1 : 0 })} />
      <Input size="sm" label="Custom message" value={selected.CustomMessage ?? ''}
        onChange={(e) => updateZone({ CustomMessage: e.target.value })} />
      <ItemChipGrid
        label="Zone items"
        hint="Item classnames this zone whitelists or blocks (per the toggle above)."
        values={selected.Items ?? []}
        onChange={(v) => updateZone({ Items: v })}
        typeOptions={typeOptions}
        emptyText="No items — the zone applies to all building."
      />
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <MarkerPin01 size={40} className="text-gray-200 mb-3" />
      <h3 className="text-base font-bold text-gray-900 dark:text-white">Select a zone</h3>
      <p className="text-sm text-gray-500 max-w-xs">Choose a build zone to edit, or click + to add one. Drag on the map to reposition or resize.</p>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Build Zones</span>
          <Button size="xs" variant="secondary-gray" icon={Plus} onClick={addZone} />
        </div>
        <div className="p-3 border-b border-gray-200 dark:border-gray-800">
          <Toggle label="Zones are no-build zones" slim
            isSelected={noBuild} onChange={(v) => setBaseBuilding({ ...baseBuilding, ZonesAreNoBuildZones: v ? 1 : 0 })} />
        </div>
        <div className="p-2 space-y-1">
          {zones.length === 0 && (
            <p className="p-3 text-xs text-gray-400">No zones yet. Click + to create a build zone.</p>
          )}
          {zones.map((z, i) => (
            <button key={i} onClick={() => setSelectedZoneIdx(i)}
              className={cx('w-full text-left p-3 rounded-lg border transition-all',
                selectedZoneIdx === i ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                  : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold truncate">{z.Name || 'Unnamed'}</span>
                <Badge size="sm" color={z.IsWhitelist ? 'brand' : 'gray'}>{z.IsWhitelist ? 'allow' : 'block'}</Badge>
              </div>
              <span className="text-xs text-gray-400 truncate block">
                {Math.round(z.Center?.[0] ?? 0)}, {Math.round(z.Center?.[2] ?? 0)} · R{Math.round(z.Radius || 0)} · {(z.Items?.length ?? 0)} item{(z.Items?.length ?? 0) === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Build Zones</h3>
            <p className="text-sm text-gray-500 max-w-xl">
              Circular zones stored in <code>BaseBuildingSettings.json</code>. Drag a marker to move a zone
              or its outer handle to resize. Zones share the Base Building save.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selected && (
              <>
                <Button variant="secondary-gray" icon={Copy01} onClick={() => duplicateZone(selectedZoneIdx!)}>Duplicate</Button>
                <Button variant="error-secondary" icon={Trash01} onClick={() => deleteZone(selectedZoneIdx!)}>Delete</Button>
              </>
            )}
            <Button variant="primary" icon={Save01} onClick={onSave} disabled={!dirty}>Save Base Building</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 max-w-5xl">
          <AirdropDropLocationMap map={map} locations={drops} selectedIndex={selectedZoneIdx}
            onSelect={setSelectedZoneIdx} onChange={handleMapChange} labelPrefix="Zone" />
          <div className="space-y-3">{editorPanel}</div>
        </div>
      </div>
    </div>
  );
};
