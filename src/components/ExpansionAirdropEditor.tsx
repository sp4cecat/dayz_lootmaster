import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Toggle } from '@/components/base/toggle/toggle';
import { ComboBox, ComboBoxItem } from '@/components/base/combobox/combobox';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import {
  Plus, Save01, Package, RefreshCcw01, Trash01, Copy01,
  Settings01, MarkerPin01, AlertCircle, CheckCircle, Target04, ClockRefresh,
} from '@untitledui/icons';
import { Loadout } from '@/types/loadouts';
import { cx } from '@/utils/cx';
import { useMapMetadata } from '@/hooks/useMapMetadata';
import { MapMetadata } from '@/consts/maps';
import { AirdropLootEditor } from './airdrop/AirdropLootEditor';
import { AirdropDropLocationMap, DropLocation } from './AirdropDropLocationMap';

interface ExpansionAirdropEditorProps {
  selectedProfileId: string;
  getApiBase: () => string;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  missionName?: string;
}

type SaveState = { kind: 'idle' | 'saving' | 'ok' | 'error'; message?: string };
type TabId = 'core' | 'scheduling' | 'missions';

const NUMERIC_CORE_FIELDS: { key: string; label: string; suffix?: string }[] = [
  { key: 'ItemCount', label: 'Default Item Count' },
  { key: 'InfectedCount', label: 'Default Infected Count' },
];

const CONTAINER_CLASS_OPTIONS: string[] = [
  'ExpansionAirdropContainer',
  'ExpansionAirdropContainer_Grey',
  'ExpansionAirdropContainer_Blue',
  'ExpansionAirdropContainer_Olive',
  'ExpansionAirdropContainer_Medical',
  'ExpansionAirdropContainer_Military',
  'ExpansionAirdropContainer_Military_GreenCamo',
  'ExpansionAirdropContainer_Military_MarineCamo',
  'ExpansionAirdropContainer_Military_OliveCamo',
  'ExpansionAirdropContainer_Military_OliveCamo2',
  'ExpansionAirdropContainer_Military_WinterCamo',
  'ExpansionAirdropContainer_Basebuilding',
];

const INFECTED_CLASSNAMES = [
  "ZmbF_BlueCollarFat_Blue", "ZmbF_BlueCollarFat_Green", "ZmbF_BlueCollarFat_Red", "ZmbF_BlueCollarFat_White",
  "ZmbF_CitizenANormal_Beige", "ZmbF_CitizenANormal_Blue", "ZmbF_CitizenANormal_Brown", "ZmbF_CitizenBSkinny",
  "ZmbF_Clerk_Normal_Blue", "ZmbF_Clerk_Normal_Green", "ZmbF_Clerk_Normal_Red", "ZmbF_Clerk_Normal_White",
  "ZmbF_DoctorSkinny", "ZmbF_HikerSkinny_Blue", "ZmbF_HikerSkinny_Green", "ZmbF_HikerSkinny_Grey", "ZmbF_HikerSkinny_Red",
  "ZmbF_JoggerSkinny_Blue", "ZmbF_JoggerSkinny_Brown", "ZmbF_JoggerSkinny_Green", "ZmbF_JoggerSkinny_Red",
  "ZmbF_JournalistNormal_Blue", "ZmbF_JournalistNormal_Green", "ZmbF_JournalistNormal_Red", "ZmbF_JournalistNormal_White",
  "ZmbF_MechanicNormal_Beige", "ZmbF_MechanicNormal_Green", "ZmbF_MechanicNormal_Grey", "ZmbF_MechanicNormal_Orange",
  "ZmbF_MilkMaidOld_Beige", "ZmbF_MilkMaidOld_Black", "ZmbF_MilkMaidOld_Green", "ZmbF_MilkMaidOld_Grey",
  "ZmbF_NurseFat", "ZmbF_ParamedicNormal_Blue", "ZmbF_ParamedicNormal_Green", "ZmbF_ParamedicNormal_Red",
  "ZmbF_PatientOld", "ZmbF_PoliceWomanNormal", "ZmbM_CitizenASkinny_Blue", "ZmbM_CitizenASkinny_Brown",
  "ZmbM_CitizenASkinny_Grey", "ZmbM_CitizenASkinny_Red", "ZmbM_CitizenBFat_Blue", "ZmbM_CitizenBFat_Green",
  "ZmbM_CitizenBFat_Red", "ZmbM_ClerkFat_Brown", "ZmbM_ClerkFat_Grey", "ZmbM_ClerkFat_Khaki", "ZmbM_ClerkFat_White",
  "ZmbM_CommercialPilotOld_Blue", "ZmbM_CommercialPilotOld_Brown", "ZmbM_CommercialPilotOld_Grey",
  "ZmbM_CommercialPilotOld_Olive", "ZmbM_ConstrWorkerNormal_Beige", "ZmbM_ConstrWorkerNormal_Black",
  "ZmbM_ConstrWorkerNormal_Green", "ZmbM_ConstrWorkerNormal_Grey", "ZmbM_DoctorFat", "ZmbM_FarmerFat_Beige",
  "ZmbM_FarmerFat_Blue", "ZmbM_FarmerFat_Brown", "ZmbM_FarmerFat_Green", "ZmbM_FirefighterNormal",
  "ZmbM_FishermanOld_Blue", "ZmbM_FishermanOld_Green", "ZmbM_FishermanOld_Grey", "ZmbM_FishermanOld_Red",
  "ZmbM_HandymanNormal_Beige", "ZmbM_HandymanNormal_Blue", "ZmbM_HandymanNormal_Green", "ZmbM_HandymanNormal_Grey",
  "ZmbM_HandymanNormal_White", "ZmbM_HeavyIndustryWorker", "ZmbM_HermitSkinny_Beige", "ZmbM_HermitSkinny_Black",
  "ZmbM_HermitSkinny_Green", "ZmbM_HermitSkinny_Red", "ZmbM_HikerSkinny_Blue", "ZmbM_HikerSkinny_Green",
  "ZmbM_HikerSkinny_Yellow", "ZmbM_HunterOld_Autumn", "ZmbM_HunterOld_Spring", "ZmbM_HunterOld_Summer",
  "ZmbM_HunterOld_Winter", "ZmbM_Jacket_beige", "ZmbM_Jacket_black", "ZmbM_Jacket_blue", "ZmbM_Jacket_bluechecks",
  "ZmbM_PolicemanFat", "ZmbM_PolicemanSpecForce", "ZmbM_PolicemanSpecForce_Heavy",
  "ZmbM_usSoldier_AirForce_Spacecat", "ZmbM_usSoldier_Heavy_Woodland", "ZmbM_usSoldier_normal_Desert",
  "ZmbM_usSoldier_normal_Woodland", "ZmbM_usSoldier_Officer_Desert", "ZmbM_usSoldier_Woodland_Bitterroot",
  "ZmbM_usSoldier_Woodland2_Bitterroot"
];

const EAI_CLASSNAMES = [
  "eAI_SurvivorF_Eva", "eAI_SurvivorF_Frida", "eAI_SurvivorF_Gabi", "eAI_SurvivorF_Helga",
  "eAI_SurvivorF_Irena", "eAI_SurvivorF_Judy", "eAI_SurvivorF_Keiko", "eAI_SurvivorF_Linda",
  "eAI_SurvivorF_Maria", "eAI_SurvivorF_Naomi", "eAI_SurvivorF_Baty", "eAI_SurvivorM_Boris",
  "eAI_SurvivorM_Cyril", "eAI_SurvivorM_Denis", "eAI_SurvivorM_Elias", "eAI_SurvivorM_Francis",
  "eAI_SurvivorM_Guo", "eAI_SurvivorM_Hassan", "eAI_SurvivorM_Indar", "eAI_SurvivorM_Jose",
  "eAI_SurvivorM_Kaito", "eAI_SurvivorM_Lewis", "eAI_SurvivorM_Manua", "eAI_SurvivorM_Mirek",
  "eAI_SurvivorM_Niki", "eAI_SurvivorM_Oliver", "eAI_SurvivorM_Peter", "eAI_SurvivorM_Quinn",
  "eAI_SurvivorM_Rolf", "eAI_SurvivorM_Seth", "eAI_SurvivorM_Taiki"
];

const BOOL_CORE_FIELDS: { key: string; label: string }[] = [
  { key: 'Enabled', label: 'Airdrops Enabled' },
  { key: 'EnableMapMarker', label: 'Map Marker' },
  { key: 'EnableServerMarker', label: 'Server Marker' },
  { key: 'ShowNotificationServerWide', label: 'Server-wide Notification' },
];

// Airdrops are the only mission type Expansion ships, so MissionSettings.json is
// the real airdrop scheduler (timing, concurrency, player gate) — separate file
// from AirdropSettings.json.
const MISSION_BOOL_FIELDS: { key: string; label: string }[] = [
  { key: 'Enabled', label: 'Mission System Enabled' },
];
const MISSION_NUMERIC_FIELDS: { key: string; label: string; ms?: boolean }[] = [
  { key: 'InitialMissionStartDelay', label: 'Initial Start Delay', ms: true },
  { key: 'TimeBetweenMissions', label: 'Time Between Airdrops', ms: true },
  { key: 'MinMissions', label: 'Min Concurrent' },
  { key: 'MaxMissions', label: 'Max Concurrent' },
  { key: 'MinPlayersToStartMissions', label: 'Min Players To Start' },
];
const MISSION_DEFAULTS = {
  m_Version: 2, Enabled: 0, InitialMissionStartDelay: 300000,
  TimeBetweenMissions: 3600000, MinMissions: 0, MaxMissions: 1, MinPlayersToStartMissions: 0,
};

// Friendly hint under the millisecond timer fields, e.g. "= 60 min".
const formatMs = (ms: number) => {
  if (!ms || ms < 1000) return `${ms || 0} ms`;
  const s = ms / 1000;
  if (s < 60) return `= ${s} sec`;
  const m = s / 60;
  return m < 60 ? `= ${+m.toFixed(m % 1 ? 1 : 0)} min` : `= ${+(m / 60).toFixed(1)} h`;
};

export const ExpansionAirdropEditor: React.FC<ExpansionAirdropEditorProps> = ({
  selectedProfileId,
  getApiBase,
  typeOptions,
  randomPresets,
  loadouts,
  missionName,
}) => {
  const [tab, setTab] = useState<TabId>('core');
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const map = useMapMetadata(missionName);

  // Core settings
  const [settings, setSettings] = useState<any>(null);
  const [savedSettings, setSavedSettings] = useState<any>(null);
  const [selectedContainerIdx, setSelectedContainerIdx] = useState<number | null>(null);

  // Mission scheduling (MissionSettings.json — separate file from AirdropSettings.json)
  const [missionSettings, setMissionSettings] = useState<any>(null);
  const [savedMissionSettings, setSavedMissionSettings] = useState<any>(null);

  // Missions
  const [missions, setMissions] = useState<{ file: string; data: any }[]>([]);
  const [selectedMissionIdx, setSelectedMissionIdx] = useState<number | null>(null);

  const headers = useMemo(() => ({ 'X-Profile-ID': selectedProfileId }), [selectedProfileId]);

  const load = async () => {
    if (!getApiBase || !selectedProfileId) return;
    setLoading(true);
    try {
      const [sRes, mRes, msRes] = await Promise.all([
        fetch(`${getApiBase()}/api/expansion/airdrop-settings`, { headers }),
        fetch(`${getApiBase()}/api/expansion/airdrop-missions`, { headers }),
        fetch(`${getApiBase()}/api/expansion/mission-settings`, { headers }),
      ]);
      if (sRes.ok) {
        const data = await sRes.json();
        setSettings(data);
        setSavedSettings(data);
      } else {
        const fallback = { Enabled: 1, Containers: [] };
        setSettings(fallback);
        setSavedSettings(fallback);
      }
      if (mRes.ok) setMissions(buildMissions(await mRes.json(), map.worldSize));
      if (msRes.ok) {
        const data = await msRes.json();
        setMissionSettings(data);
        setSavedMissionSettings(data);
      } else {
        // File may not exist yet — seed defaults; the first save (PUT) creates it.
        setMissionSettings({ ...MISSION_DEFAULTS });
        setSavedMissionSettings({ ...MISSION_DEFAULTS });
      }
    } catch (e) {
      console.error('Failed to load airdrop data', e);
      setSaveState({ kind: 'error', message: 'Failed to load airdrop data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    setSelectedContainerIdx(null);
    setSelectedMissionIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  const containerNames: string[] = useMemo(
    () => (settings?.Containers || []).map((c: any) => c.Container).filter(Boolean),
    [settings]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-gray-950">
      <header className="px-6 pt-5 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Air Drops</h1>
            <p className="text-xs text-gray-500">Configure Expansion airdrop containers and missions</p>
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
          {([['core', 'Core Settings', Settings01], ['scheduling', 'Scheduling', ClockRefresh], ['missions', 'Missions', MarkerPin01]] as const).map(([id, label, Icon]) => (
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

      {loading && !settings ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCcw01 className="animate-spin text-primary-600" size={32} />
        </div>
      ) : tab === 'core' ? (
        <CoreSettingsTab
          settings={settings}
          setSettings={setSettings}
          selectedContainerIdx={selectedContainerIdx}
          setSelectedContainerIdx={setSelectedContainerIdx}
          typeOptions={typeOptions}
          randomPresets={randomPresets}
          loadouts={loadouts}
          getApiBase={getApiBase}
          headers={headers}
          setSaveState={setSaveState}
          savedSettings={savedSettings}
          setSavedSettings={setSavedSettings}
          customInfected={map.customInfected}
        />
      ) : tab === 'scheduling' ? (
        <SchedulingTab
          missionSettings={missionSettings}
          setMissionSettings={setMissionSettings}
          savedMissionSettings={savedMissionSettings}
          setSavedMissionSettings={setSavedMissionSettings}
          getApiBase={getApiBase}
          headers={headers}
          setSaveState={setSaveState}
        />
      ) : (
        <MissionsTab
          missions={missions}
          setMissions={setMissions}
          selectedMissionIdx={selectedMissionIdx}
          setSelectedMissionIdx={setSelectedMissionIdx}
          containerNames={containerNames}
          map={map}
          typeOptions={typeOptions}
          randomPresets={randomPresets}
          loadouts={loadouts}
          getApiBase={getApiBase}
          headers={headers}
          setSaveState={setSaveState}
        />
      )}
    </div>
  );
};

interface CoreTabProps {
  settings: any;
  setSettings: (s: any) => void;
  selectedContainerIdx: number | null;
  setSelectedContainerIdx: (i: number | null) => void;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  getApiBase: () => string;
  headers: Record<string, string>;
  setSaveState: (s: SaveState) => void;
  savedSettings: any;
  setSavedSettings: (s: any) => void;
  customInfected?: string[];
}

const CoreSettingsTab: React.FC<CoreTabProps> = ({
  settings, setSettings, selectedContainerIdx, setSelectedContainerIdx,
  typeOptions, randomPresets, loadouts, getApiBase, headers, setSaveState,
  savedSettings, setSavedSettings, customInfected,
}) => {
  const containers = settings?.Containers || [];

  const updateField = (key: string, value: any) => setSettings({ ...settings, [key]: value });

  const updateContainer = (idx: number, patch: any) => {
    const next = { ...settings, Containers: containers.map((c: any, i: number) => (i === idx ? { ...c, ...patch } : c)) };
    setSettings(next);
  };

  const deleteContainer = (idx: number) => {
    setSettings({ ...settings, Containers: containers.filter((_: any, i: number) => i !== idx) });
    // Keep the selection pointing at the same visual position (or clear it if the
    // selected container was the one removed / the list becomes empty).
    const nextIdx =
      selectedContainerIdx === null || selectedContainerIdx === idx ? null
        : selectedContainerIdx > idx ? selectedContainerIdx - 1
          : selectedContainerIdx;
    setSelectedContainerIdx(nextIdx);
  };

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await fetch(`${getApiBase()}/api/expansion/airdrop-settings`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setSavedSettings(settings);
      setSaveState({ kind: 'ok' });
      setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
    } catch (e: any) {
      setSaveState({ kind: 'error', message: e.message });
    }
  };

  const isDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings]
  );

  const selected = selectedContainerIdx !== null ? containers[selectedContainerIdx] : null;

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto flex flex-col">
        <div className="p-4 space-y-3 border-b border-gray-200 dark:border-gray-800">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Global Settings</span>
          {BOOL_CORE_FIELDS.map(({ key, label }) => (
            <Toggle key={key} label={label} isSelected={!!settings?.[key]} onChange={(v) => updateField(key, v ? 1 : 0)} />
          ))}
          {NUMERIC_CORE_FIELDS.map(({ key, label, suffix }) => (
            <Input key={key} size="sm" label={label} type="number" suffix={suffix}
              value={settings?.[key] ?? ''} onChange={(e) => updateField(key, Number(e.target.value))} />
          ))}
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Containers</span>
            <Button size="xs" variant="secondary-gray" icon={Plus} onClick={() => {
              setSettings({ ...settings, Containers: [...containers, { Container: 'NewContainer', Loot: [], Infected: [] }] });
              setSelectedContainerIdx(containers.length);
            }} />
          </div>
          <div className="space-y-1">
            {containers.map((c: any, i: number) => (
              <Tooltip key={i} title={c.Container} placement="right" delay={400}>
                <TooltipTrigger onPress={() => setSelectedContainerIdx(i)}
                  className={cx('w-full text-left p-3 rounded-lg border transition-all',
                    selectedContainerIdx === i ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                      : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{c.Container}</span>
                    <Badge size="sm" color="gray">{c.Loot?.length || 0}</Badge>
                  </div>
                </TooltipTrigger>
              </Tooltip>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-4">
          {selected ? (
            <Button variant="error-secondary" icon={Trash01}
              onClick={() => deleteContainer(selectedContainerIdx!)}>Delete Container</Button>
          ) : <span />}
          <Button variant="primary" icon={Save01} onClick={save} disabled={!isDirty}>Save Core Settings</Button>
        </div>
        {selected ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Container Class</label>
                <ComboBox aria-label="Container Class" allowsCustomValue
                  items={CONTAINER_CLASS_OPTIONS.map((id) => ({ id }))}
                  selectedKey={selected.Container || ''}
                  inputValue={selected.Container || ''}
                  onInputChange={(v) => updateContainer(selectedContainerIdx!, { Container: v })}
                  onSelectionChange={(k) => k && updateContainer(selectedContainerIdx!, { Container: String(k) })}>
                  {(item: { id: string }) => <ComboBoxItem id={item.id}>{item.id}</ComboBoxItem>}
                </ComboBox>
              </div>
              <div className="flex items-end pb-2">
                <Toggle label="Spawn Smoke" isSelected={!!selected.SpawnSmoke}
                  onChange={(v) => updateContainer(selectedContainerIdx!, { SpawnSmoke: v ? 1 : 0 })} />
              </div>
              <Input label="Item Count" type="number" value={selected.ItemCount ?? ''}
                onChange={(e) => updateContainer(selectedContainerIdx!, { ItemCount: Number(e.target.value) })} />
              <Input label="Infected Count" type="number" value={selected.InfectedCount ?? ''}
                onChange={(e) => updateContainer(selectedContainerIdx!, { InfectedCount: Number(e.target.value) })} />
            </div>

            <InfectedList values={selected.Infected || []} customInfected={customInfected} onChange={(v) => updateContainer(selectedContainerIdx!, { Infected: v })} />

            <div className="border-t border-gray-100 dark:border-gray-800 pt-6">
              <AirdropLootEditor
                key={`container-${selectedContainerIdx}`}
                initialLoot={selected.Loot || []}
                onChange={(loot) => updateContainer(selectedContainerIdx!, { Loot: loot })}
                typeOptions={typeOptions}
                randomPresets={randomPresets}
                loadouts={loadouts}
              />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <Package size={48} className="text-gray-200 mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Select a container</h3>
            <p className="text-sm text-gray-500 max-w-xs">Choose an airdrop container to configure its loot and settings.</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface SchedulingTabProps {
  missionSettings: any;
  setMissionSettings: (s: any) => void;
  savedMissionSettings: any;
  setSavedMissionSettings: (s: any) => void;
  getApiBase: () => string;
  headers: Record<string, string>;
  setSaveState: (s: SaveState) => void;
}

// Mission scheduling (MissionSettings.json). Airdrops are the only Expansion
// mission type, so these settings are what actually control when/how often
// airdrops spawn — separate file/endpoint from the airdrop core settings.
const SchedulingTab: React.FC<SchedulingTabProps> = ({
  missionSettings, setMissionSettings, savedMissionSettings, setSavedMissionSettings,
  getApiBase, headers, setSaveState,
}) => {
  const updateMission = (key: string, value: any) => setMissionSettings({ ...missionSettings, [key]: value });

  const missionDirty = useMemo(
    () => JSON.stringify(missionSettings) !== JSON.stringify(savedMissionSettings),
    [missionSettings, savedMissionSettings]
  );

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await fetch(`${getApiBase()}/api/expansion/mission-settings`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(missionSettings),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setSavedMissionSettings(missionSettings);
      setSaveState({ kind: 'ok' });
      setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
    } catch (e: any) {
      setSaveState({ kind: 'error', message: e.message });
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Mission Scheduling</h3>
            <p className="text-sm text-gray-500 max-w-lg mt-1">
              Airdrops are the only Expansion mission type, so these settings control when and how
              often airdrops spawn. Stored in <code>MissionSettings.json</code>.
            </p>
          </div>
          <Button variant="primary" icon={Save01} onClick={save} disabled={!missionDirty}>Save Scheduling</Button>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 p-6 space-y-4">
          {MISSION_BOOL_FIELDS.map(({ key, label }) => (
            <Toggle key={key} label={label} isSelected={!!missionSettings?.[key]} onChange={(v) => updateMission(key, v ? 1 : 0)} />
          ))}
          <div className="grid grid-cols-2 gap-4">
            {MISSION_NUMERIC_FIELDS.map(({ key, label, ms }) => (
              <Input key={key} label={label} type="number" suffix={ms ? 'ms' : undefined}
                hint={ms ? formatMs(Number(missionSettings?.[key] ?? 0)) : undefined}
                value={missionSettings?.[key] ?? ''} onChange={(e) => updateMission(key, Number(e.target.value))} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const InfectedList: React.FC<{ values: string[]; onChange: (v: string[]) => void; customInfected?: string[] }> = ({ values, onChange, customInfected = [] }) => {
  const [draft, setDraft] = useState('');

  const suggestions = useMemo(() => {
    const d = draft.toLowerCase();
    if (!d) return [];
    const custom = customInfected.filter((n) => n.toLowerCase().includes(d));
    const infected = INFECTED_CLASSNAMES.filter((n) => n.toLowerCase().includes(d));
    const eai = EAI_CLASSNAMES.filter((n) => n.toLowerCase().includes(d));
    return [...custom, ...infected, ...eai].map((id) => ({ id }));
  }, [draft, customInfected]);

  const addItem = (item: string) => {
    const trimmed = item.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setDraft('');
  };

  const addAllInfected = () => {
    const all = [...customInfected, ...INFECTED_CLASSNAMES];
    const merged = [...values];
    for (const name of all) {
      if (!merged.includes(name)) merged.push(name);
    }
    onChange(merged);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Infected / AI</span>
        <Button variant="link" size="sm" onClick={addAllInfected}>All Infected</Button>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <ComboBox
            placeholder="ZmbM_... or eAI_...|faction:..."
            items={suggestions}
            inputValue={draft}
            onInputChange={setDraft}
            allowsCustomValue
            menuTrigger="focus"
            onSelectionChange={(key) => {
              if (key) {
                setDraft(String(key));
              }
            }}
          >
            {(item: { id: string }) => <ComboBoxItem id={item.id}>{item.id}</ComboBoxItem>}
          </ComboBox>
        </div>
        <Button
          variant="secondary-gray"
          icon={Plus}
          onClick={() => addItem(draft)}
          className="h-10 shrink-0"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs font-mono text-gray-700 dark:text-gray-300">
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-gray-400 hover:text-error-600">
              <Trash01 size={12} />
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-gray-400 italic">None configured.</span>}
      </div>
    </div>
  );
};

interface Mission { file: string; data: any; isNew?: boolean; corrupt?: boolean; parseError?: string; }

// Expansion requires exactly ONE DropLocation per mission file, so each file maps
// to exactly one mission with a single drop location. On disk DropLocation is kept
// as a 1-element array (the canonical Expansion shape); tolerant of legacy files
// that stored it as a bare object.
const DEFAULT_DROP = (worldSize: number): DropLocation => ({
  Name: 'New Drop', x: Math.round(worldSize / 2), z: Math.round(worldSize / 2), Radius: 500.0,
});

function buildMissions(raw: { file: string; data: any; error?: string }[], worldSize: number): Mission[] {
  return raw.map(({ file, data, error }) => {
    if (!data) {
      // Unparseable file: surface it as its own row so it can be inspected/deleted.
      return { file, data: null, corrupt: true, parseError: error || 'Invalid JSON' } as Mission;
    }
    const dl = data.DropLocation;
    const drop = (Array.isArray(dl) ? dl[0] : dl) || DEFAULT_DROP(worldSize);
    return { file, data: { ...data, DropLocation: [drop] } } as Mission;
  });
}

interface MissionsTabProps {
  missions: Mission[];
  setMissions: React.Dispatch<React.SetStateAction<Mission[]>>;
  selectedMissionIdx: number | null;
  setSelectedMissionIdx: (i: number | null) => void;
  containerNames: string[];
  map: MapMetadata;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  getApiBase: () => string;
  headers: Record<string, string>;
  setSaveState: (s: SaveState) => void;
}

const DEFAULT_MISSION = (worldSize: number) => ({
  Weight: 100,
  MissionMaxTime: 1200.0,
  MissionName: 'Random',
  Difficulty: 0,
  Objective: 0,
  Reward: '',
  ShowNotification: 1,
  Height: 600.0,
  Speed: 100.0,
  Container: 'Random',
  DropLocation: [{ Name: 'New Drop', x: Math.round(worldSize / 2), z: Math.round(worldSize / 2), Radius: 500.0 }],
  ItemCount: 25,
  InfectedCount: 15,
  Infected: [],
  Loot: [],
});

const MISSION_NUMERIC: { key: string; label: string; suffix?: string }[] = [
  { key: 'Weight', label: 'Weight' },
  { key: 'MissionMaxTime', label: 'Max Time', suffix: 'sec' },
  { key: 'Height', label: 'Plane Height', suffix: 'm' },
  { key: 'Speed', label: 'Plane Speed' },
  { key: 'ItemCount', label: 'Item Count' },
  { key: 'InfectedCount', label: 'Infected Count' },
];

const isValidMissionFile = (name: string) => /^Airdrop_[A-Za-z0-9._-]+\.json$/.test(name);

const MissionsTab: React.FC<MissionsTabProps> = ({
  missions, setMissions, selectedMissionIdx, setSelectedMissionIdx,
  containerNames, map,
  typeOptions, randomPresets, loadouts, getApiBase, headers, setSaveState,
}) => {
  const mission = selectedMissionIdx !== null ? missions[selectedMissionIdx] : null;

  const patchData = (patch: any) => {
    if (selectedMissionIdx === null) return;
    setMissions((prev) => prev.map((m, i) => (i === selectedMissionIdx ? { ...m, data: { ...m.data, ...patch } } : m)));
  };

  const patchMission = (patch: Partial<Mission>) => {
    if (selectedMissionIdx === null) return;
    setMissions((prev) => prev.map((m, i) => (i === selectedMissionIdx ? { ...m, ...patch } : m)));
  };

  const addMission = () => {
    const base = 'Airdrop_NewDrop';
    let name = `${base}.json`;
    let n = 1;
    const existing = new Set(missions.map((m) => m.file.toLowerCase()));
    while (existing.has(name.toLowerCase())) { name = `${base}${n++}.json`; }
    setMissions((prev) => [...prev, { file: name, data: DEFAULT_MISSION(map.worldSize), isNew: true }]);
    setSelectedMissionIdx(missions.length);
  };

  const duplicateMission = (idx: number) => {
    const src = missions[idx];
    let name = src.file.replace(/\.json$/i, '_Copy.json');
    const existing = new Set(missions.map((m) => m.file.toLowerCase()));
    let n = 1;
    while (existing.has(name.toLowerCase())) { name = src.file.replace(/\.json$/i, `_Copy${n++}.json`); }
    setMissions((prev) => [...prev, { file: name, data: JSON.parse(JSON.stringify(src.data)), isNew: true }]);
    setSelectedMissionIdx(missions.length);
  };

  const saveMission = async () => {
    if (!mission) return;
    if (!isValidMissionFile(mission.file)) {
      setSaveState({ kind: 'error', message: 'File must match Airdrop_*.json' });
      return;
    }
    // Expansion allows one DropLocation per mission file, so write exactly one file
    // with DropLocation as a 1-element array (the canonical Expansion shape).
    const dl = mission.data.DropLocation;
    const drop = Array.isArray(dl) ? dl[0] : dl;
    if (!drop) {
      setSaveState({ kind: 'error', message: 'Set a drop location' });
      return;
    }

    setSaveState({ kind: 'saving' });
    try {
      const res = await fetch(`${getApiBase()}/api/expansion/airdrop-missions?file=${encodeURIComponent(mission.file)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mission.data, DropLocation: [drop] }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `Failed to save ${mission.file}`);
      patchMission({ isNew: false });
      setSaveState({ kind: 'ok' });
      setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
    } catch (e: any) {
      setSaveState({ kind: 'error', message: e.message });
    }
  };

  const deleteMission = async (idx: number) => {
    const m = missions[idx];
    if (!m.isNew) {
      try {
        await fetch(`${getApiBase()}/api/expansion/airdrop-missions?file=${encodeURIComponent(m.file)}`, { method: 'DELETE', headers });
      } catch (e) {
        console.error('Failed to delete mission file', m.file, e);
      }
    }
    setMissions((prev) => prev.filter((_, i) => i !== idx));
    setSelectedMissionIdx(null);
  };

  const isUnique = mission && !mission.corrupt ? (mission.data.Container !== 'Random' || (mission.data.Loot || []).length > 0) : false;

  const setMode = (unique: boolean) => {
    if (unique) {
      patchData({ Container: containerNames[0] || mission?.data?.Container || 'Container_Base' });
    } else {
      patchData({ Container: 'Random', Loot: [] });
    }
  };

  const dl = mission?.data?.DropLocation;
  const drop: DropLocation | null = (Array.isArray(dl) ? dl[0] : dl) || null;

  const updateDrop = (patch: Partial<DropLocation>) =>
    patchData({ DropLocation: [{ ...(drop || { x: 0, z: 0 }), ...patch }] });

  const containerOptions = useMemo(() => {
    const set = new Set<string>(['Random', ...containerNames]);
    if (mission?.data?.Container) set.add(mission.data.Container);
    return Array.from(set).map((c) => ({ id: c }));
  }, [containerNames, mission?.data?.Container]);

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Missions</span>
          <Button size="xs" variant="secondary-gray" icon={Plus} onClick={addMission} />
        </div>
        <div className="p-2 space-y-1">
          {missions.length === 0 && (
            <p className="p-3 text-xs text-gray-400">No mission files. Click + to create one.</p>
          )}
          {missions.map((m, i) => (
            <button key={i} onClick={() => setSelectedMissionIdx(i)}
              className={cx('w-full text-left p-3 rounded-lg border transition-all',
                selectedMissionIdx === i ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                  : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
              <div className="flex items-center justify-between gap-2">
                <span className={cx('text-sm font-semibold truncate', m.corrupt && 'text-error-600')}>{m.file.replace(/^Airdrop_/, '').replace(/\.json$/i, '')}</span>
                {m.corrupt ? <Badge size="sm" color="error">Corrupt</Badge> : m.isNew && <Badge size="sm" color="warning">New</Badge>}
              </div>
              <span className="text-xs text-gray-400 truncate block">{m.corrupt ? 'Invalid JSON' : (m.data?.Container || '—')}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex-1 overflow-auto p-6">
        {mission && mission.corrupt ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
            <AlertCircle size={48} className="text-error-500 mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Corrupt mission file</h3>
            <p className="text-sm text-gray-500 mt-1">
              <span className="font-mono text-gray-700 dark:text-gray-300">{mission.file}</span> could not be parsed as JSON, so the server ignores it. Fix the file by hand, or delete it.
            </p>
            {mission.parseError && <p className="text-xs text-error-600 mt-2 font-mono">{mission.parseError}</p>}
            <Button variant="error-secondary" icon={Trash01} className="mt-5" onClick={() => deleteMission(selectedMissionIdx!)}>Delete File</Button>
          </div>
        ) : mission ? (
          <div className="space-y-6 max-w-5xl">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Input label="File Name" value={mission.file} disabled={!mission.isNew}
                  error={mission.isNew && !isValidMissionFile(mission.file) ? 'Must match Airdrop_*.json' : undefined}
                  onChange={(e) => patchMission({ file: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Button variant="secondary-gray" icon={Copy01} onClick={() => duplicateMission(selectedMissionIdx!)}>Duplicate</Button>
                <Button variant="error-secondary" icon={Trash01} onClick={() => deleteMission(selectedMissionIdx!)}>Delete</Button>
                <Button variant="primary" icon={Save01} onClick={saveMission}>Save</Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Input label="Mission Name" value={mission.data.MissionName ?? ''} onChange={(e) => patchData({ MissionName: e.target.value })} />
              {MISSION_NUMERIC.map(({ key, label, suffix }) => (
                <Input key={key} label={label} type="number" suffix={suffix}
                  value={mission.data[key] ?? ''} onChange={(e) => patchData({ [key]: Number(e.target.value) })} />
              ))}
            </div>

            <div className="flex items-center gap-6">
              <Toggle label="Show Notification" isSelected={!!mission.data.ShowNotification}
                onChange={(v) => patchData({ ShowNotification: v ? 1 : 0 })} />
              <Toggle label="Unique loot (override container)" isSelected={isUnique} onChange={setMode} />
            </div>

            {isUnique && (
              <div className="max-w-sm">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Container</label>
                <ComboBox aria-label="Container" allowsCustomValue items={containerOptions}
                  selectedKey={mission.data.Container}
                  inputValue={mission.data.Container}
                  onInputChange={(v) => patchData({ Container: v })}
                  onSelectionChange={(k) => k && patchData({ Container: String(k) })}>
                  {(item: { id: string }) => <ComboBoxItem id={item.id}>{item.id}</ComboBoxItem>}
                </ComboBox>
              </div>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                  <Target04 size={14} /> Drop Location
                </span>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <AirdropDropLocationMap map={map} locations={drop ? [drop] : []} selectedIndex={drop ? 0 : null}
                  onSelect={() => {}} onChange={(next) => updateDrop(next[0] || {})} />
                <div className="space-y-2">
                  {drop && (
                    <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800">
                      <div className="mb-2">
                        <Input size="sm" value={drop.Name || ''} placeholder="Location name"
                          onChange={(e) => updateDrop({ Name: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Input size="sm" type="number" suffix="X" value={Math.round(drop.x)}
                          onChange={(e) => updateDrop({ x: Number(e.target.value) })} />
                        <Input size="sm" type="number" suffix="Z" value={Math.round(drop.z)}
                          onChange={(e) => updateDrop({ z: Number(e.target.value) })} />
                        <Input size="sm" type="number" suffix="R" value={Math.round(drop.Radius || 0)}
                          onChange={(e) => updateDrop({ Radius: Number(e.target.value) })} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <InfectedList values={mission.data.Infected || []} customInfected={map.customInfected} onChange={(v) => patchData({ Infected: v })} />

            {isUnique && (
              <div className="border-t border-gray-100 dark:border-gray-800 pt-6">
                <AirdropLootEditor
                  key={`mission-${selectedMissionIdx}`}
                  initialLoot={mission.data.Loot || []}
                  onChange={(loot) => patchData({ Loot: loot })}
                  typeOptions={typeOptions}
                  randomPresets={randomPresets}
                  loadouts={loadouts}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <MarkerPin01 size={48} className="text-gray-200 mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Select a mission</h3>
            <p className="text-sm text-gray-500 max-w-xs">Choose an airdrop mission file, or create a new one to place drop zones on the map.</p>
          </div>
        )}
      </div>
    </div>
  );
};
