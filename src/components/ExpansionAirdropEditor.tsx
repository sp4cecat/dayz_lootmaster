import React, { useState, useEffect, useMemo } from 'react';
import { useTabParam } from '@/hooks/useHashRoute';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Toggle } from '@/components/base/toggle/toggle';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Select } from '@/components/base/select/select';
import { ComboBox, ComboBoxItem } from '@/components/base/combobox/combobox';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import {
  Plus, Save01, Package, RefreshCcw01, Trash01, Copy01,
  Settings01, MarkerPin01, AlertCircle, CheckCircle, Target04, ClockRefresh, Map01, Link01,
  Maximize01, Minimize01, ChevronDown, ChevronRight,
} from '@untitledui/icons';
import { Loadout } from '@/types/loadouts';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
import { useMapMetadata } from '@/hooks/useMapMetadata';
import { MapMetadata } from '@/consts/maps';
import { AirdropLootEditor } from './airdrop/AirdropLootEditor';
import { AirdropDropLocationMap, DropLocation, AirdropLocation } from './AirdropDropLocationMap';

interface ExpansionAirdropEditorProps {
  selectedProfileId: string;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  missionName?: string;
}

type SaveState = { kind: 'idle' | 'saving' | 'ok' | 'error'; message?: string };
type TabId = 'core' | 'containers' | 'scheduling' | 'missions' | 'locations';

// Stable-ish id generator for Lootmaster-owned location entries (crypto.randomUUID
// where available, else a random suffix). Never written to Expansion mission files.
const genLocationId = (): string =>
  `loc_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10)).replace(/-/g, '').slice(0, 8)}`;

// Match tolerance when de-duplicating drop locations into the library: same Name
// (case-insensitive) and identical rounded coordinates/radius.
const sameZone = (a: { Name?: string; x: number; z: number; Radius?: number }, b: { Name?: string; x: number; z: number; Radius?: number }) =>
  (a.Name || '').trim().toLowerCase() === (b.Name || '').trim().toLowerCase() &&
  Math.round(a.x) === Math.round(b.x) &&
  Math.round(a.z) === Math.round(b.z) &&
  Math.round(a.Radius || 0) === Math.round(b.Radius || 0);

// Build the initial locations library from the loaded missions' inline DropLocations,
// de-duplicating identical zones. Used to auto-seed when no library file exists yet.
function seedLocationsFromMissions(missions: { data: any }[]): AirdropLocation[] {
  const out: AirdropLocation[] = [];
  for (const m of missions) {
    const dl = m?.data?.DropLocation;
    const drop = Array.isArray(dl) ? dl[0] : dl;
    if (!drop || typeof drop.x !== 'number' || typeof drop.z !== 'number') continue;
    if (out.some((l) => sameZone(l, drop))) continue;
    out.push({
      id: genLocationId(),
      Name: (drop.Name || 'Drop').trim(),
      x: Math.round(drop.x),
      z: Math.round(drop.z),
      Radius: drop.Radius != null ? Math.round(drop.Radius) : 500,
    });
  }
  return out;
}

// Real AirdropSettings.json (ExpansionAirdropSettings VERSION 8) top-level numeric
// fields. See the ExpansionAirdropSettings.c source — these are the plane/drop
// tuning globals; per-mission files can override Height/Speed/DropZone*.
const NUMERIC_CORE_FIELDS: { key: string; label: string; suffix?: string; hint?: string }[] = [
  { key: 'Height', label: 'Plane Height', suffix: 'm' },
  { key: 'DropZoneHeight', label: 'Drop Zone Height', suffix: 'm' },
  { key: 'FollowTerrainFraction', label: 'Follow Terrain Fraction', hint: '0–1' },
  { key: 'Speed', label: 'Plane Speed', suffix: 'm/s' },
  { key: 'DropZoneSpeed', label: 'Drop Zone Speed', suffix: 'm/s' },
  { key: 'Radius', label: 'Drop Radius', suffix: 'm' },
  { key: 'InfectedSpawnRadius', label: 'Infected Spawn Radius', suffix: 'm' },
  { key: 'InfectedSpawnInterval', label: 'Infected Spawn Interval', suffix: 'ms' },
  { key: 'DropZoneProximityDistance', label: 'Drop Zone Proximity', suffix: 'm' },
  { key: 'ItemCount', label: 'Item Count (legacy)', hint: 'Fallback; set per container' },
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

// Real AirdropSettings.json (VERSION 8) top-level boolean toggles.
const BOOL_CORE_FIELDS: { key: string; label: string }[] = [
  { key: 'ServerMarkerOnDropLocation', label: 'Server Marker on Drop' },
  { key: 'Server3DMarkerOnDropLocation', label: '3D Marker on Drop' },
  { key: 'ShowAirdropTypeOnMarker', label: 'Show Airdrop Type on Marker' },
  { key: 'HideCargoWhileParachuteIsDeployed', label: 'Hide Cargo While Parachuting' },
  { key: 'HeightIsRelativeToGroundLevel', label: 'Height Relative to Ground' },
  { key: 'ExplodeAirVehiclesOnCollision', label: 'Explode Air Vehicles on Collision' },
];

// Container Usage: which drop kinds this container is eligible for.
const USAGE_OPTIONS = [
  { value: '0', label: 'Missions & player-called' },
  { value: '1', label: 'Only missions' },
  { value: '2', label: 'Only player-called' },
];

// Container-level ExplodeAirVehiclesOnCollision is tri-state: -1 inherits the
// global AirdropSettings value, 0 off, 1 on.
const EXPLODE_OPTIONS = [
  { value: '-1', label: 'Default (inherit)' },
  { value: '0', label: 'Off' },
  { value: '1', label: 'On' },
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

// Number input paired with a "Default" checkbox. Expansion inherits several
// per-container / per-mission values from a parent when they are left at the
// sentinel -1 (ItemCount/InfectedCount) or <= 0 (Speed/DropZoneSpeed/FallSpeed):
// container ItemCount/InfectedCount fall back to the global AirdropSettings, and
// mission ItemCount/InfectedCount/Speed fall back to the container then global.
// Checking Default stores -1 (which satisfies both sentinels), disables the input,
// and shows the resolved default value as a placeholder.
const DefaultableNumber: React.FC<{
  label: string;
  value: number | undefined;
  resolvedDefault?: number;
  onChange: (v: number) => void;
  suffix?: string;
  size?: 'sm' | 'md';
}> = ({ label, value, resolvedDefault, onChange, suffix, size }) => {
  const inheriting = value == null || value === -1;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <Checkbox size="sm" label="Default" isSelected={inheriting} onChange={(on) => onChange(on ? -1 : (resolvedDefault ?? 0))} />
      </div>
      <Input type="number" size={size} suffix={suffix} disabled={inheriting}
        value={inheriting ? '' : value}
        placeholder={inheriting ? `Default${resolvedDefault != null ? `: ${resolvedDefault}` : ' (inherited)'}` : undefined}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
};

export const ExpansionAirdropEditor: React.FC<ExpansionAirdropEditorProps> = ({
  selectedProfileId,
  typeOptions,
  randomPresets,
  loadouts,
  missionName,
}) => {
  const [tab, setTab] = useTabParam<TabId>('core', ['core', 'containers', 'scheduling', 'missions', 'locations']);
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

  // Locations library (Lootmaster-owned; missions reference these by Name)
  const [locations, setLocations] = useState<AirdropLocation[]>([]);
  const [savedLocations, setSavedLocations] = useState<AirdropLocation[]>([]);
  const [selectedLocationIdx, setSelectedLocationIdx] = useState<number | null>(null);

  const load = async () => {
    if (!selectedProfileId) return;
    setLoading(true);
    try {
      const [sRes, mRes, msRes, lRes] = await Promise.all([
        apiFetch('/api/expansion/airdrop-settings', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/airdrop-missions', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/mission-settings', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/airdrop-locations', { profileId: selectedProfileId }),
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
      const builtMissions = mRes.ok ? buildMissions(await mRes.json(), map.worldSize) : [];
      if (mRes.ok) setMissions(builtMissions);
      if (msRes.ok) {
        const data = await msRes.json();
        setMissionSettings(data);
        setSavedMissionSettings(data);
      } else {
        // File may not exist yet — seed defaults; the first save (PUT) creates it.
        setMissionSettings({ ...MISSION_DEFAULTS });
        setSavedMissionSettings({ ...MISSION_DEFAULTS });
      }
      // Locations library: load the Lootmaster-owned file, or auto-seed from the
      // missions' inline DropLocations when it doesn't exist yet. A seeded library
      // is left "dirty" (savedLocations = []) so the first save persists it.
      let loadedLocations: AirdropLocation[] | null = null;
      if (lRes.ok) {
        try {
          const data = await lRes.json();
          if (Array.isArray(data?.locations)) loadedLocations = data.locations;
        } catch { /* fall through to seeding */ }
      }
      if (loadedLocations && loadedLocations.length > 0) {
        setLocations(loadedLocations);
        setSavedLocations(loadedLocations);
      } else {
        const seeded = seedLocationsFromMissions(builtMissions);
        setLocations(seeded);
        setSavedLocations(loadedLocations ? loadedLocations : []);
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
    setSelectedLocationIdx(null);
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
          {([['core', 'Core Settings', Settings01], ['containers', 'Containers', Package], ['scheduling', 'Scheduling', ClockRefresh], ['locations', 'Locations', Map01], ['missions', 'Missions', MarkerPin01]] as const).map(([id, label, Icon]) => (
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
          selectedProfileId={selectedProfileId}
          setSaveState={setSaveState}
          savedSettings={savedSettings}
          setSavedSettings={setSavedSettings}
        />
      ) : tab === 'containers' ? (
        <ContainersTab
          settings={settings}
          setSettings={setSettings}
          selectedContainerIdx={selectedContainerIdx}
          setSelectedContainerIdx={setSelectedContainerIdx}
          typeOptions={typeOptions}
          randomPresets={randomPresets}
          loadouts={loadouts}
          selectedProfileId={selectedProfileId}
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
          selectedProfileId={selectedProfileId}
          setSaveState={setSaveState}
        />
      ) : tab === 'locations' ? (
        <LocationsTab
          locations={locations}
          setLocations={setLocations}
          savedLocations={savedLocations}
          setSavedLocations={setSavedLocations}
          selectedLocationIdx={selectedLocationIdx}
          setSelectedLocationIdx={setSelectedLocationIdx}
          missions={missions}
          setMissions={setMissions}
          map={map}
          selectedProfileId={selectedProfileId}
          setSaveState={setSaveState}
        />
      ) : (
        <MissionsTab
          missions={missions}
          setMissions={setMissions}
          selectedMissionIdx={selectedMissionIdx}
          setSelectedMissionIdx={setSelectedMissionIdx}
          containerNames={containerNames}
          settings={settings}
          locations={locations}
          map={map}
          typeOptions={typeOptions}
          randomPresets={randomPresets}
          loadouts={loadouts}
          selectedProfileId={selectedProfileId}
          setSaveState={setSaveState}
        />
      )}
    </div>
  );
};

interface CoreTabProps {
  settings: any;
  setSettings: (s: any) => void;
  selectedProfileId: string;
  setSaveState: (s: SaveState) => void;
  savedSettings: any;
  setSavedSettings: (s: any) => void;
}

const CoreSettingsTab: React.FC<CoreTabProps> = ({
  settings, setSettings, selectedProfileId, setSaveState,
  savedSettings, setSavedSettings,
}) => {
  const updateField = (key: string, value: any) => setSettings({ ...settings, [key]: value });

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/expansion/airdrop-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
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

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-end mb-4">
          <Button variant="primary" icon={Save01} onClick={save} disabled={!isDirty}>Save Core Settings</Button>
        </div>
        <div className="p-4 space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Global Settings</span>
          {BOOL_CORE_FIELDS.map(({ key, label }) => (
            <Toggle key={key} label={label} isSelected={!!settings?.[key]} onChange={(v) => updateField(key, v ? 1 : 0)} />
          ))}
          {NUMERIC_CORE_FIELDS.map(({ key, label, suffix, hint }) => (
            <Input key={key} size="sm" label={label} type="number" suffix={suffix} hint={hint}
              value={settings?.[key] ?? ''} onChange={(e) => updateField(key, Number(e.target.value))} />
          ))}
          <Input size="sm" label="Airdrop Plane Class" placeholder="(default plane)"
            value={settings?.AirdropPlaneClassName ?? ''} onChange={(e) => updateField('AirdropPlaneClassName', e.target.value)} />
        </div>
      </div>
    </div>
  );
};

interface ContainersTabProps {
  settings: any;
  setSettings: (s: any) => void;
  selectedContainerIdx: number | null;
  setSelectedContainerIdx: (i: number | null) => void;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  selectedProfileId: string;
  setSaveState: (s: SaveState) => void;
  savedSettings: any;
  setSavedSettings: (s: any) => void;
  customInfected?: string[];
}

const ContainersTab: React.FC<ContainersTabProps> = ({
  settings, setSettings, selectedContainerIdx, setSelectedContainerIdx,
  typeOptions, randomPresets, loadouts, selectedProfileId, setSaveState,
  savedSettings, setSavedSettings, customInfected,
}) => {
  const containers = settings?.Containers || [];

  // Core container classes may each appear at most once in AirdropSettings.json.
  // Track which are already taken so we only offer unused ones (this restriction
  // is intentionally NOT applied to the per-mission editor).
  const usedContainerClasses = new Set<string>(
    containers.map((c: any) => c.Container).filter(Boolean)
  );
  const firstUnusedClass = CONTAINER_CLASS_OPTIONS.find(
    (cls) => !usedContainerClasses.has(cls)
  );

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
      const res = await apiFetch(`/api/expansion/airdrop-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
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

  // Options for the selected container's Container Class field: every known class
  // not already used by another container, plus the selected container's own value
  // (including a legacy/unknown class) so it stays visible and selectable.
  const containerClassOptions = [
    ...CONTAINER_CLASS_OPTIONS.filter(
      (cls) => !usedContainerClasses.has(cls) || cls === selected?.Container
    ),
    ...(selected?.Container && !CONTAINER_CLASS_OPTIONS.includes(selected.Container)
      ? [selected.Container]
      : []),
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-[380px] border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto flex flex-col">
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Containers</span>
            <Tooltip
              title={firstUnusedClass ? 'Add container' : 'All container classes are already in use'}
              placement="left" delay={400}>
              <TooltipTrigger
                isDisabled={!firstUnusedClass}
                onPress={() => {
                  if (!firstUnusedClass) return;
                  setSettings({ ...settings, Containers: [...containers, { Container: firstUnusedClass, Usage: 0, Weight: 1, FallSpeed: 4.5, ItemCount: -1, InfectedCount: 15, SpawnInfectedForPlayerCalledDrops: 0, ExplodeAirVehiclesOnCollision: -1, Loot: [], Infected: [] }] });
                  setSelectedContainerIdx(containers.length);
                }}
                className={cx(
                  'inline-flex items-center justify-center rounded-lg px-2 py-1.5 border shadow-sm transition-all',
                  'bg-white text-gray-700 hover:bg-gray-50 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700',
                  !firstUnusedClass && 'opacity-50 cursor-not-allowed'
                )}>
                <Plus size={14} className="shrink-0" />
              </TooltipTrigger>
            </Tooltip>
          </div>
          <div className="space-y-1">
            {containers.map((c: any, i: number) => (
              <Tooltip key={i} title={c.Container} placement="right" delay={400}>
                <TooltipTrigger onPress={() => setSelectedContainerIdx(i)}
                  className={cx('w-full text-left p-3 rounded-lg border transition-all',
                    selectedContainerIdx === i ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                      : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate min-w-0 flex-1">{c.Container}</span>
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
          <Button variant="primary" icon={Save01} onClick={save} disabled={!isDirty}>Save Containers</Button>
        </div>
        {selected ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Container Class</label>
                <ComboBox aria-label="Container Class"
                  items={containerClassOptions.map((id) => ({ id }))}
                  selectedKey={selected.Container || ''}
                  onSelectionChange={(k) => k && updateContainer(selectedContainerIdx!, { Container: String(k) })}>
                  {(item: { id: string }) => <ComboBoxItem id={item.id}>{item.id}</ComboBoxItem>}
                </ComboBox>
              </div>
              <Select label="Usage" options={USAGE_OPTIONS} value={String(selected.Usage ?? 0)}
                onChange={(e) => updateContainer(selectedContainerIdx!, { Usage: Number(e.target.value) })} />
              <Input label="Weight" type="number" value={selected.Weight ?? ''}
                onChange={(e) => updateContainer(selectedContainerIdx!, { Weight: Number(e.target.value) })} />
              <Input label="Fall Speed" type="number" suffix="m/s" value={selected.FallSpeed ?? ''}
                onChange={(e) => updateContainer(selectedContainerIdx!, { FallSpeed: Number(e.target.value) })} />
              <DefaultableNumber label="Item Count" value={selected.ItemCount} resolvedDefault={settings?.ItemCount}
                onChange={(v) => updateContainer(selectedContainerIdx!, { ItemCount: v })} />
              <Input label="Infected Count" type="number" value={selected.InfectedCount ?? ''}
                onChange={(e) => updateContainer(selectedContainerIdx!, { InfectedCount: Number(e.target.value) })} />
              <div className="flex items-end pb-2">
                <Toggle label="Spawn Infected for Player-Called Drops" isSelected={!!selected.SpawnInfectedForPlayerCalledDrops}
                  onChange={(v) => updateContainer(selectedContainerIdx!, { SpawnInfectedForPlayerCalledDrops: v ? 1 : 0 })} />
              </div>
              <Select label="Explode Air Vehicles on Collision" options={EXPLODE_OPTIONS} value={String(selected.ExplodeAirVehiclesOnCollision ?? -1)}
                onChange={(e) => updateContainer(selectedContainerIdx!, { ExplodeAirVehiclesOnCollision: Number(e.target.value) })} />
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
  selectedProfileId: string;
  setSaveState: (s: SaveState) => void;
}

// Mission scheduling (MissionSettings.json). Airdrops are the only Expansion
// mission type, so these settings are what actually control when/how often
// airdrops spawn — separate file/endpoint from the airdrop core settings.
const SchedulingTab: React.FC<SchedulingTabProps> = ({
  missionSettings, setMissionSettings, savedMissionSettings, setSavedMissionSettings,
  selectedProfileId, setSaveState,
}) => {
  const updateMission = (key: string, value: any) => setMissionSettings({ ...missionSettings, [key]: value });

  const missionDirty = useMemo(
    () => JSON.stringify(missionSettings) !== JSON.stringify(savedMissionSettings),
    [missionSettings, savedMissionSettings]
  );

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/expansion/mission-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
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

interface LocationsTabProps {
  locations: AirdropLocation[];
  setLocations: React.Dispatch<React.SetStateAction<AirdropLocation[]>>;
  savedLocations: AirdropLocation[];
  setSavedLocations: (l: AirdropLocation[]) => void;
  selectedLocationIdx: number | null;
  setSelectedLocationIdx: (i: number | null) => void;
  missions: Mission[];
  setMissions: React.Dispatch<React.SetStateAction<Mission[]>>;
  map: MapMetadata;
  selectedProfileId: string;
  setSaveState: (s: SaveState) => void;
}

// Case-insensitive linkage key used to match a mission's DropLocation.Name to a
// library location Name.
const nameKey = (n?: string) => (n || '').trim().toLowerCase();

// Reusable-locations library. Locations are Lootmaster-owned; missions reference
// them by Name and get the coordinates inlined into their Airdrop_*.json on save.
const LocationsTab: React.FC<LocationsTabProps> = ({
  locations, setLocations, savedLocations, setSavedLocations,
  selectedLocationIdx, setSelectedLocationIdx,
  missions, setMissions, map, selectedProfileId, setSaveState,
}) => {
  const selected = selectedLocationIdx !== null ? locations[selectedLocationIdx] : null;
  // When on, the map grows to use the available vertical height (up to the image's
  // native size) and the editor moves to a side column.
  const [mapFill, setMapFill] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(locations) !== JSON.stringify(savedLocations),
    [locations, savedLocations]
  );

  // Missions that currently reference a location (by DropLocation.Name).
  const referencingMissions = (loc: AirdropLocation) => missions.filter((m) => {
    if (m.corrupt) return false;
    const dl = m.data?.DropLocation;
    const drop = Array.isArray(dl) ? dl[0] : dl;
    return drop && nameKey(drop.Name) === nameKey(loc.Name);
  });
  const refCount = (loc: AirdropLocation) => referencingMissions(loc).length;

  const updateLocation = (patch: Partial<AirdropLocation>) => {
    if (selectedLocationIdx === null) return;
    setLocations(locations.map((l, i) => (i === selectedLocationIdx ? { ...l, ...patch } : l)));
  };

  // The map hands back a DropLocation[]; fold it back onto the library entries,
  // preserving each location's Lootmaster id and Name by index.
  const handleMapChange = (next: DropLocation[]) => {
    setLocations(next.map((d, i) => ({
      id: locations[i]?.id ?? genLocationId(),
      Name: (d.Name ?? locations[i]?.Name ?? 'Drop'),
      x: Math.round(d.x),
      z: Math.round(d.z),
      Radius: d.Radius != null ? Math.round(d.Radius) : locations[i]?.Radius,
    })));
  };

  const addLocation = () => {
    const loc: AirdropLocation = {
      id: genLocationId(), Name: `Location ${locations.length + 1}`,
      x: Math.round(map.worldSize / 2), z: Math.round(map.worldSize / 2), Radius: 500,
    };
    setLocations([...locations, loc]);
    setSelectedLocationIdx(locations.length);
  };

  const duplicateLocation = (idx: number) => {
    const src = locations[idx];
    setLocations([...locations, { ...src, id: genLocationId(), Name: `${src.Name} Copy` }]);
    setSelectedLocationIdx(locations.length);
  };

  const deleteLocation = (idx: number) => {
    const loc = locations[idx];
    // Deny deletion while any airdrop mission still references this location — the
    // user must delete or reassign those missions first, else they'd point at a
    // location name that no longer exists in the library.
    const users = referencingMissions(loc);
    if (users.length > 0) {
      const names = users.map((m) => `  • ${m.file.replace(/^Airdrop_/, '').replace(/\.json$/i, '')}`).join('\n');
      window.alert(
        `Can't delete «${loc.Name || 'Unnamed'}» — ${users.length} airdrop mission${users.length === 1 ? '' : 's'} use this location:\n\n${names}\n\nDelete those airdrops, or edit them to use a different location, first.`
      );
      return;
    }
    setLocations(locations.filter((_, i) => i !== idx));
    const nextIdx =
      selectedLocationIdx === null || selectedLocationIdx === idx ? null
        : selectedLocationIdx > idx ? selectedLocationIdx - 1
          : selectedLocationIdx;
    setSelectedLocationIdx(nextIdx);
  };

  // Missions whose inlined DropLocation is now stale relative to the library. A
  // mission is linked by its *previous* Name (from savedLocations) so renames still
  // match; new/unsaved mission files are skipped (they persist via their own save).
  const computeMissionUpdates = (): { file: string; data: any }[] => {
    const ups: { file: string; data: any }[] = [];
    for (const loc of locations) {
      const prev = savedLocations.find((l) => l.id === loc.id);
      const linkName = nameKey(prev?.Name ?? loc.Name);
      if (!linkName) continue;
      for (const m of missions) {
        if (m.corrupt || m.isNew || ups.some((u) => u.file === m.file)) continue;
        const dl = m.data?.DropLocation;
        const drop = Array.isArray(dl) ? dl[0] : dl;
        if (!drop || nameKey(drop.Name) !== linkName) continue;
        const stale =
          (drop.Name || '') !== loc.Name ||
          Math.round(drop.x) !== Math.round(loc.x) ||
          Math.round(drop.z) !== Math.round(loc.z) ||
          Math.round(drop.Radius || 0) !== Math.round(loc.Radius || 0);
        if (stale) {
          const desired = { ...drop, Name: loc.Name, x: loc.x, z: loc.z, Radius: loc.Radius };
          ups.push({ file: m.file, data: { ...m.data, DropLocation: desired } });
        }
      }
    }
    return ups;
  };

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/expansion/airdrop-locations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
        body: JSON.stringify({ locations }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');

      // Offer to push the updated coordinates into any missions that reference
      // these locations, so the on-disk Airdrop_*.json files stay in sync.
      const updates = computeMissionUpdates();
      if (updates.length > 0 &&
        confirm(`${updates.length} mission${updates.length === 1 ? '' : 's'} reference these locations. Update their drop coordinates to match?`)) {
        await Promise.all(updates.map((u) =>
          apiFetch(`/api/expansion/airdrop-missions?file=${encodeURIComponent(u.file)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            profileId: selectedProfileId,
            body: JSON.stringify(u.data),
          })
        ));
        setMissions((prev) => prev.map((m) => {
          const u = updates.find((x) => x.file === m.file);
          return u ? { ...m, data: u.data } : m;
        }));
      }

      setSavedLocations(locations);
      setSaveState({ kind: 'ok' });
      setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
    } catch (e: any) {
      setSaveState({ kind: 'error', message: e.message });
    }
  };

  // Shared editor markup — rendered beside the map in both compact and fill layouts.
  const editorPanel = selected ? (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 space-y-3">
      <Input label="Location Name" value={selected.Name}
        onChange={(e) => updateLocation({ Name: e.target.value })} />
      <div className="grid grid-cols-3 gap-2">
        <Input size="sm" label="X" type="number" value={Math.round(selected.x)}
          onChange={(e) => updateLocation({ x: Number(e.target.value) })} />
        <Input size="sm" label="Z" type="number" value={Math.round(selected.z)}
          onChange={(e) => updateLocation({ z: Number(e.target.value) })} />
        <Input size="sm" label="Radius" type="number" value={Math.round(selected.Radius || 0)}
          onChange={(e) => updateLocation({ Radius: Number(e.target.value) })} />
      </div>
      <p className="text-xs text-gray-400">
        Referenced by {refCount(selected)} mission{refCount(selected) === 1 ? '' : 's'}.
      </p>
    </div>
  ) : (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <Map01 size={40} className="text-gray-200 mb-3" />
      <h3 className="text-base font-bold text-gray-900 dark:text-white">Select a location</h3>
      <p className="text-sm text-gray-500 max-w-xs">Choose a drop zone to edit, or click + to add one. Drag on the map to reposition or resize.</p>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Locations</span>
          <Button size="xs" variant="secondary-gray" icon={Plus} onClick={addLocation} />
        </div>
        <div className="p-2 space-y-1">
          {locations.length === 0 && (
            <p className="p-3 text-xs text-gray-400">No locations yet. Click + to create a reusable drop zone.</p>
          )}
          {locations.map((loc, i) => {
            const count = refCount(loc);
            return (
              <button key={loc.id} onClick={() => setSelectedLocationIdx(i)}
                className={cx('w-full text-left p-3 rounded-lg border transition-all',
                  selectedLocationIdx === i ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                    : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate">{loc.Name || 'Unnamed'}</span>
                  <Tooltip title={`${count} mission${count === 1 ? '' : 's'} use this location`} placement="right" delay={400}>
                    <TooltipTrigger>
                      <Badge size="sm" color={count > 0 ? 'brand' : 'gray'}>{count}</Badge>
                    </TooltipTrigger>
                  </Tooltip>
                </div>
                <span className="text-xs text-gray-400 truncate block">{Math.round(loc.x)}, {Math.round(loc.z)} · R{Math.round(loc.Radius || 0)}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className={cx('flex-1 p-6', mapFill ? 'flex flex-col overflow-hidden' : 'overflow-auto')}>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Drop Locations</h3>
            <p className="text-sm text-gray-500 max-w-xl">
              Reusable named drop zones. Reference them from the <span className="font-medium">Missions</span> tab;
              saving here can push coordinate changes into every mission that uses a location.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip title={mapFill ? 'Back to compact map' : 'Zoom map to fill available height'} placement="bottom" delay={400}>
              <TooltipTrigger>
                <Button variant={mapFill ? 'primary' : 'secondary-gray'} icon={mapFill ? Minimize01 : Maximize01}
                  onClick={() => setMapFill((v) => !v)}>{mapFill ? 'Compact' : 'Fit height'}</Button>
              </TooltipTrigger>
            </Tooltip>
            {selected && (
              <>
                <Button variant="secondary-gray" icon={Copy01} onClick={() => duplicateLocation(selectedLocationIdx!)}>Duplicate</Button>
                <Button variant="error-secondary" icon={Trash01} onClick={() => deleteLocation(selectedLocationIdx!)}>Delete</Button>
              </>
            )}
            <Button variant="primary" icon={Save01} onClick={save} disabled={!isDirty}>Save Locations</Button>
          </div>
        </div>

        {mapFill ? (
          <div className="flex-1 min-h-0 flex gap-6">
            <div className="flex-1 min-h-0 flex justify-center">
              <AirdropDropLocationMap fill map={map} locations={locations} selectedIndex={selectedLocationIdx}
                onSelect={setSelectedLocationIdx} onChange={handleMapChange} />
            </div>
            <div className="w-80 shrink-0 overflow-auto">{editorPanel}</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 max-w-5xl">
            <AirdropDropLocationMap map={map} locations={locations} selectedIndex={selectedLocationIdx}
              onSelect={setSelectedLocationIdx} onChange={handleMapChange} />
            <div className="space-y-3">{editorPanel}</div>
          </div>
        )}
      </div>
    </div>
  );
};

const InfectedList: React.FC<{ values: string[]; onChange: (v: string[]) => void; customInfected?: string[] }> = ({ values, onChange, customInfected = [] }) => {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false); // collapsed accordion by default

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
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          Infected / AI
          {values.length > 0 && (
            <span className="normal-case font-normal text-gray-500">({values.length})</span>
          )}
        </button>
        {open && <Button variant="link" size="sm" onClick={addAllInfected}>All Infected</Button>}
      </div>
      {open && (
        <>
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
        </>
      )}
    </div>
  );
};

interface Mission { file: string; data: any; isNew?: boolean; corrupt?: boolean; parseError?: string; }

// Expansion requires exactly ONE DropLocation per mission file, so each file maps
// to exactly one mission with a single drop location. On disk DropLocation is a
// bare object (the canonical Expansion shape: ref ExpansionAirdropLocation);
// tolerant of legacy files that stored it as a 1-element array.
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
    // Expansion's mission class declares DropLocation as a single object
    // (ref ExpansionAirdropLocation), so we normalise to an object on disk.
    // Reads stay tolerant of legacy 1-element-array files.
    return { file, data: { ...data, DropLocation: drop } } as Mission;
  });
}

interface MissionsTabProps {
  missions: Mission[];
  setMissions: React.Dispatch<React.SetStateAction<Mission[]>>;
  selectedMissionIdx: number | null;
  setSelectedMissionIdx: (i: number | null) => void;
  containerNames: string[];
  settings: any;
  locations: AirdropLocation[];
  map: MapMetadata;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  selectedProfileId: string;
  setSaveState: (s: SaveState) => void;
}

// Matches ExpansionMissionEventAirdrop (VERSION 3) defaults (see OnDefaultMission):
// ItemCount/InfectedCount default to -1 (inherit from the container, then global
// AirdropSettings); Speed/DropZoneSpeed inherit from AirdropSettings when <= 0.
const DEFAULT_MISSION = (worldSize: number) => ({
  m_Version: 3,
  Enabled: 1,
  Weight: 100,
  MissionMaxTime: 1200,
  MissionName: 'Random',
  Difficulty: 0,
  Objective: 0,
  Reward: '',
  ShowNotification: 1,
  Height: 450.0,
  DropZoneHeight: 450.0,
  Speed: -1,
  DropZoneSpeed: -1,
  Container: 'Random',
  FallSpeed: 4.5,
  DropLocation: { Name: 'New Drop', x: Math.round(worldSize / 2), z: Math.round(worldSize / 2), Radius: 500.0 },
  Infected: [],
  ItemCount: -1,
  InfectedCount: -1,
  AirdropPlaneClassName: '',
  Loot: [],
});

// Plain per-mission numeric fields (no inheritance). Speed/DropZoneSpeed/ItemCount/
// InfectedCount are rendered separately with DefaultableNumber.
const MISSION_NUMERIC: { key: string; label: string; suffix?: string }[] = [
  { key: 'Weight', label: 'Weight' },
  { key: 'MissionMaxTime', label: 'Max Time', suffix: 'sec' },
  { key: 'Height', label: 'Plane Height', suffix: 'm' },
  { key: 'DropZoneHeight', label: 'Drop Zone Height', suffix: 'm' },
];

const isValidMissionFile = (name: string) => /^Airdrop_[A-Za-z0-9._-]+\.json$/.test(name);

// Minify a drop-location name to a filename-safe token (alphanumerics only).
const minifyName = (s: string) => (s || '').replace(/[^A-Za-z0-9]/g, '');

// Derive an `Airdrop_<MinifiedLocation>.json` file name, suffixing with a number
// (2, 3, …) when another mission already uses that file. `excludeIdx` skips the
// mission being renamed so it doesn't collide with itself.
const fileNameForLocation = (locName: string, missions: Mission[], excludeIdx: number): string => {
  const base = minifyName(locName) || 'Drop';
  const taken = new Set(missions.filter((_, i) => i !== excludeIdx).map((m) => m.file.toLowerCase()));
  let name = `Airdrop_${base}.json`;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `Airdrop_${base}${n++}.json`;
  return name;
};

// Group a mission by its drop-location name for the sidebar accordion.
const groupOf = (m: Mission): { key: string; label: string } => {
  if (m.corrupt) return { key: ' corrupt', label: 'Corrupt files' };
  const dl = m.data?.DropLocation;
  const d = Array.isArray(dl) ? dl[0] : dl;
  const name = (d?.Name || '').trim();
  return name ? { key: name.toLowerCase(), label: name } : { key: ' unnamed', label: 'Unnamed location' };
};

const MissionsTab: React.FC<MissionsTabProps> = ({
  missions, setMissions, selectedMissionIdx, setSelectedMissionIdx,
  containerNames, settings, locations, map,
  typeOptions, randomPresets, loadouts, selectedProfileId, setSaveState,
}) => {
  const mission = selectedMissionIdx !== null ? missions[selectedMissionIdx] : null;

  // Sidebar accordion: missions grouped by drop location, default collapsed.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; items: { m: Mission; idx: number }[] }>();
    missions.forEach((m, idx) => {
      const { key, label } = groupOf(m);
      if (!byKey.has(key)) byKey.set(key, { key, label, items: [] });
      byKey.get(key)!.items.push({ m, idx });
    });
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [missions]);

  // Reveal the selected mission by opening its group (after add/duplicate/select, or
  // when its drop location changes); the user can still collapse it afterwards.
  const selectedGroupKey = mission ? groupOf(mission).key : null;
  useEffect(() => {
    if (selectedGroupKey === null) return;
    setOpenGroups((s) => (s[selectedGroupKey] ? s : { ...s, [selectedGroupKey]: true }));
  }, [selectedGroupKey]);

  const patchData = (patch: any) => {
    if (selectedMissionIdx === null) return;
    setMissions((prev) => prev.map((m, i) => (i === selectedMissionIdx ? { ...m, data: { ...m.data, ...patch } } : m)));
  };

  const patchMission = (patch: Partial<Mission>) => {
    if (selectedMissionIdx === null) return;
    setMissions((prev) => prev.map((m, i) => (i === selectedMissionIdx ? { ...m, ...patch } : m)));
  };

  const addMission = () => {
    const data = DEFAULT_MISSION(map.worldSize);
    const dropName = (Array.isArray(data.DropLocation) ? data.DropLocation[0] : data.DropLocation)?.Name || 'New Drop';
    const name = fileNameForLocation(dropName, missions, -1);
    setMissions((prev) => [...prev, { file: name, data, isNew: true }]);
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
    // Expansion allows one DropLocation per mission file, written as a single
    // object (ref ExpansionAirdropLocation) — the canonical Expansion shape.
    const dl = mission.data.DropLocation;
    const drop = Array.isArray(dl) ? dl[0] : dl;
    if (!drop) {
      setSaveState({ kind: 'error', message: 'Set a drop location' });
      return;
    }

    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/expansion/airdrop-missions?file=${encodeURIComponent(mission.file)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
        body: JSON.stringify({ ...mission.data, DropLocation: drop }),
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
        await apiFetch(`/api/expansion/airdrop-missions?file=${encodeURIComponent(m.file)}`, { method: 'DELETE', profileId: selectedProfileId });
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
    patchData({ DropLocation: { ...(drop || { x: 0, z: 0 }), ...patch } });

  // Copy a whole library location into this mission's drop (Name + coords). New
  // (unsaved) mission files are auto-named after the location; already-saved files
  // keep their name so we never orphan an on-disk file.
  const applyLocation = (loc: AirdropLocation) => {
    if (selectedMissionIdx === null) return;
    setMissions((prev) => prev.map((m, i) => {
      if (i !== selectedMissionIdx) return m;
      const prevDrop = Array.isArray(m.data?.DropLocation) ? m.data.DropLocation[0] : m.data?.DropLocation;
      const nextData = { ...m.data, DropLocation: { ...(prevDrop || {}), Name: loc.Name, x: loc.x, z: loc.z, Radius: loc.Radius } };
      const file = m.isNew ? fileNameForLocation(loc.Name, prev, i) : m.file;
      return { ...m, data: nextData, file };
    }));
  };

  // Options for the location picker: library locations plus a "Custom…" escape hatch.
  const CUSTOM_KEY = '__custom__';
  const locationOptions = useMemo(
    () => [{ id: CUSTOM_KEY, label: 'Custom…' }, ...locations.map((l) => ({ id: l.id, label: l.Name }))],
    [locations]
  );
  // The mission is "linked" to a library location when its drop Name matches one.
  const linkedLocation = useMemo(
    () => (drop ? locations.find((l) => (l.Name || '').trim().toLowerCase() === (drop.Name || '').trim().toLowerCase()) : undefined),
    [locations, drop]
  );

  const containerOptions = useMemo(() => {
    const set = new Set<string>(['Random', ...containerNames]);
    if (mission?.data?.Container) set.add(mission.data.Container);
    return Array.from(set).map((c) => ({ id: c }));
  }, [containerNames, mission?.data?.Container]);

  // Resolved defaults shown when a mission field is set to inherit (see
  // ExpansionMissionEventAirdrop.Event_OnStart): ItemCount/InfectedCount inherit
  // from the selected container (ItemCount then falls back to global), and
  // Speed/DropZoneSpeed inherit from the global AirdropSettings.
  const missionDefaults = useMemo(() => {
    const cont = (settings?.Containers || []).find((c: any) => c?.Container === mission?.data?.Container);
    const contItem = cont && cont.ItemCount > 0 ? cont.ItemCount : settings?.ItemCount;
    return {
      ItemCount: contItem,
      InfectedCount: cont?.InfectedCount,
      Speed: settings?.Speed,
      DropZoneSpeed: settings?.DropZoneSpeed,
    };
  }, [settings, mission?.data?.Container]);

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
          {groups.map((g) => {
            const open = !!openGroups[g.key];
            return (
              <div key={g.key}>
                <button onClick={() => setOpenGroups((s) => ({ ...s, [g.key]: !s[g.key] }))}
                  className="w-full flex items-center gap-1.5 px-2 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800/50">
                  {open ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 truncate flex-1 text-left">{g.label}</span>
                  <Badge size="sm" color="gray">{g.items.length}</Badge>
                </button>
                {open && (
                  <div className="pl-3 space-y-1 mt-1">
                    {g.items.map(({ m, idx }) => {
                      // Second meta line differentiates missions that share a location:
                      // weight plus item/infected counts (a count of -1 means "inherit the
                      // global default", so it's omitted).
                      const ic = m.data?.ItemCount;
                      const inf = m.data?.InfectedCount;
                      const stats = [`W${m.data?.Weight ?? 0}`];
                      if (ic != null && ic !== -1) stats.push(`${ic} items`);
                      if (inf != null && inf !== -1) stats.push(`${inf} inf`);
                      return (
                        <button key={idx} onClick={() => setSelectedMissionIdx(idx)}
                          className={cx('w-full text-left p-3 rounded-lg border transition-all',
                            selectedMissionIdx === idx ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                              : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={cx('text-sm font-semibold truncate', m.corrupt && 'text-error-600')}>{m.file.replace(/^Airdrop_/, '').replace(/\.json$/i, '')}</span>
                            {m.corrupt ? <Badge size="sm" color="error">Corrupt</Badge> : m.isNew && <Badge size="sm" color="warning">New</Badge>}
                          </div>
                          {m.corrupt ? (
                            <span className="text-xs text-gray-400 truncate block">Invalid JSON</span>
                          ) : (
                            <>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate block">{m.data?.Container || '—'}</span>
                              <span className="text-[11px] text-gray-400 truncate block">{stats.join(' · ')}</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
              <DefaultableNumber label="Plane Speed" suffix="m/s" value={mission.data.Speed} resolvedDefault={missionDefaults.Speed}
                onChange={(v) => patchData({ Speed: v })} />
              <DefaultableNumber label="Drop Zone Speed" suffix="m/s" value={mission.data.DropZoneSpeed} resolvedDefault={missionDefaults.DropZoneSpeed}
                onChange={(v) => patchData({ DropZoneSpeed: v })} />
              <DefaultableNumber label="Item Count" value={mission.data.ItemCount} resolvedDefault={missionDefaults.ItemCount}
                onChange={(v) => patchData({ ItemCount: v })} />
              <DefaultableNumber label="Infected Count" value={mission.data.InfectedCount} resolvedDefault={missionDefaults.InfectedCount}
                onChange={(v) => patchData({ InfectedCount: v })} />
            </div>

            <div className="flex items-center gap-6">
              <Toggle label="Enabled" isSelected={!!mission.data.Enabled}
                onChange={(v) => patchData({ Enabled: v ? 1 : 0 })} />
              <Toggle label="Show Notification" isSelected={!!mission.data.ShowNotification}
                onChange={(v) => patchData({ ShowNotification: v ? 1 : 0 })} />
              <Toggle label="Unique loot (override container)" isSelected={isUnique} onChange={setMode} />
            </div>

            <div className="max-w-sm">
              <Input label="Airdrop Plane Class" placeholder="(inherit from settings)"
                value={mission.data.AirdropPlaneClassName ?? ''} onChange={(e) => patchData({ AirdropPlaneClassName: e.target.value })} />
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
                {linkedLocation && (
                  <span className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400">
                    <Link01 size={12} /> Linked to «{linkedLocation.Name}»
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-6">
                <AirdropDropLocationMap map={map} locations={drop ? [drop] : []} selectedIndex={drop ? 0 : null}
                  onSelect={() => {}} onChange={(next) => updateDrop(next[0] || {})} />
                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Use Location</label>
                    <ComboBox aria-label="Use Location" items={locationOptions}
                      selectedKey={linkedLocation?.id ?? CUSTOM_KEY}
                      onSelectionChange={(k) => {
                        if (!k || k === CUSTOM_KEY) return;
                        const loc = locations.find((l) => l.id === String(k));
                        if (loc) applyLocation(loc);
                      }}>
                      {(item: { id: string; label: string }) => <ComboBoxItem id={item.id}>{item.label}</ComboBoxItem>}
                    </ComboBox>
                    <p className="text-xs text-gray-400 mt-1">Pick a saved location, or edit coordinates below for a custom drop.</p>
                  </div>
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
