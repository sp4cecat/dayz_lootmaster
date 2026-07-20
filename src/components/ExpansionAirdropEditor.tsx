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
import { Modal } from '@/components/base/modal/modal';
import {
  Plus, Save01, Package, RefreshCcw01, Trash01, Copy01,
  Settings01, MarkerPin01, AlertCircle, CheckCircle, Target04, Map01, Link01,
  Maximize01, Minimize01, ChevronDown, ChevronRight, LayersThree01, LinkBroken01,
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
type TabId = 'core' | 'containers' | 'missions' | 'locations' | 'lootlists';

// A reusable, named loot list. Stored in its native Expansion Loot[] shape (identical
// to container.Loot) so it drops straight into a container/mission with no conversion.
export interface LootList {
  id: string;   // Lootmaster-internal, stable across renames; never written to game files
  Name: string;
  Loot: any[];  // ExpansionLoot[]
}

// Binds a loot list to a container/mission. Lives only in the Lootmaster sidecar — the
// engine has no external loot reference, so on save the list's Loot is flattened into
// the target's Loot[]. targetKey = container ClassName (unique) or mission file name.
export interface LootListLink {
  listId: string;
  targetType: 'container' | 'mission';
  targetKey: string;
}

// Stable-ish id generator for Lootmaster-owned location entries (crypto.randomUUID
// where available, else a random suffix). Never written to Expansion mission files.
const genLocationId = (): string =>
  `loc_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10)).replace(/-/g, '').slice(0, 8)}`;

// Stable-ish id generator for Lootmaster-owned loot lists. Never written to game files.
const genLootListId = (): string =>
  `list_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10)).replace(/-/g, '').slice(0, 8)}`;

// Persist the Loot Lists sidecar ({lists, links}) to disk. Throws on failure.
async function putLootLists(profileId: string, lists: LootList[], links: LootListLink[]) {
  const res = await apiFetch('/api/expansion/airdrop-loot-lists', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    profileId,
    body: JSON.stringify({ lists, links }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
}

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

// Complete VERSION-8 AirdropSettings.json seed, mirroring the mod's
// ExpansionAirdropSettings.Defaults() (values verified against
// ExpansionAirdropSettings.c). Used when the file doesn't exist yet so the first
// save writes a full, mod-accurate file instead of a sparse one the mod would
// backfill with zeroed class defaults. Booleans are 1/0 (Expansion JSON convention).
const DEFAULT_SETTINGS = {
  m_Version: 8,
  ServerMarkerOnDropLocation: 1,
  Server3DMarkerOnDropLocation: 1,
  ShowAirdropTypeOnMarker: 1,
  HideCargoWhileParachuteIsDeployed: 1,
  HeightIsRelativeToGroundLevel: 1,
  Height: 450,
  DropZoneHeight: 450,
  FollowTerrainFraction: 0.5,
  Speed: 35,
  DropZoneSpeed: 35,
  Radius: 1,
  InfectedSpawnRadius: 50,
  InfectedSpawnInterval: 250,
  ItemCount: 50,
  AirdropPlaneClassName: '',
  DropZoneProximityDistance: 1500,
  ExplodeAirVehiclesOnCollision: 0,
  Containers: [] as any[],
};

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
  const [tab, setTab] = useTabParam<TabId>('core', ['core', 'containers', 'missions', 'locations', 'lootlists']);
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

  // Loot Lists library (Lootmaster-owned; containers/missions consume these by copy or live link)
  const [lootLists, setLootLists] = useState<LootList[]>([]);
  const [savedLootLists, setSavedLootLists] = useState<LootList[]>([]);
  const [lootLinks, setLootLinks] = useState<LootListLink[]>([]);
  const [savedLootLinks, setSavedLootLinks] = useState<LootListLink[]>([]);
  const [selectedLootListIdx, setSelectedLootListIdx] = useState<number | null>(null);

  const load = async () => {
    if (!selectedProfileId) return;
    setLoading(true);
    try {
      const [sRes, mRes, msRes, lRes, llRes] = await Promise.all([
        apiFetch('/api/expansion/airdrop-settings', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/airdrop-missions', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/mission-settings', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/airdrop-locations', { profileId: selectedProfileId }),
        apiFetch('/api/expansion/airdrop-loot-lists', { profileId: selectedProfileId }),
      ]);
      if (sRes.ok) {
        const data = await sRes.json();
        setSettings(data);
        setSavedSettings(data);
      } else {
        const fallback = { ...DEFAULT_SETTINGS };
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
      // Loot Lists library: Lootmaster-owned; empty when the file doesn't exist yet
      // (the first save creates it). No auto-seeding — lists are authored explicitly.
      let loadedLists: LootList[] = [];
      let loadedLinks: LootListLink[] = [];
      if (llRes.ok) {
        try {
          const data = await llRes.json();
          if (Array.isArray(data?.lists)) loadedLists = data.lists;
          if (Array.isArray(data?.links)) loadedLinks = data.links;
        } catch { /* leave empty */ }
      }
      setLootLists(loadedLists);
      setSavedLootLists(loadedLists);
      setLootLinks(loadedLinks);
      setSavedLootLinks(loadedLinks);
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
    setSelectedLootListIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  const containerNames: string[] = useMemo(
    () => (settings?.Containers || []).map((c: any) => c.Container).filter(Boolean),
    [settings]
  );

  // Persist a link-set change (link/unlink from the Containers/Missions editors) to the
  // sidecar immediately, so a link is durable regardless of which tab's Save is used.
  // Writes the current in-memory lists too, but leaves savedLootLists untouched so the
  // Loot Lists tab keeps its own dirty state.
  const persistLootLinks = async (nextLinks: LootListLink[]) => {
    setLootLinks(nextLinks);
    try {
      await putLootLists(selectedProfileId, lootLists, nextLinks);
      setSavedLootLinks(nextLinks);
    } catch (e: any) {
      setSaveState({ kind: 'error', message: e.message || 'Failed to save loot-list link' });
    }
  };

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
          {([['core', 'Core Settings', Settings01], ['containers', 'Containers', Package], ['lootlists', 'Loot Lists', LayersThree01], ['locations', 'Locations', Map01], ['missions', 'Missions', MarkerPin01]] as const).map(([id, label, Icon]) => (
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
          missionSettings={missionSettings}
          setMissionSettings={setMissionSettings}
          savedMissionSettings={savedMissionSettings}
          setSavedMissionSettings={setSavedMissionSettings}
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
          lootLists={lootLists}
          lootLinks={lootLinks}
          persistLootLinks={persistLootLinks}
          setTab={setTab}
        />
      ) : tab === 'lootlists' ? (
        <LootListsTab
          lootLists={lootLists}
          setLootLists={setLootLists}
          savedLootLists={savedLootLists}
          setSavedLootLists={setSavedLootLists}
          lootLinks={lootLinks}
          savedLootLinks={savedLootLinks}
          setSavedLootLinks={setSavedLootLinks}
          selectedLootListIdx={selectedLootListIdx}
          setSelectedLootListIdx={setSelectedLootListIdx}
          settings={settings}
          setSettings={setSettings}
          setSavedSettings={setSavedSettings}
          missions={missions}
          setMissions={setMissions}
          typeOptions={typeOptions}
          randomPresets={randomPresets}
          loadouts={loadouts}
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
          lootLists={lootLists}
          lootLinks={lootLinks}
          persistLootLinks={persistLootLinks}
          setTab={setTab}
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
  // Mission scheduling (MissionSettings.json) — shown as a second column here,
  // saved independently from the core airdrop settings.
  missionSettings: any;
  setMissionSettings: (s: any) => void;
  savedMissionSettings: any;
  setSavedMissionSettings: (s: any) => void;
}

const CoreSettingsTab: React.FC<CoreTabProps> = ({
  settings, setSettings, selectedProfileId, setSaveState,
  savedSettings, setSavedSettings,
  missionSettings, setMissionSettings, savedMissionSettings, setSavedMissionSettings,
}) => {
  const updateField = (key: string, value: any) => setSettings({ ...settings, [key]: value });

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/expansion/airdrop-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
        // Always stamp the current schema version so the mod never runs its legacy
        // migration converters against our current-shape data.
        body: JSON.stringify({ ...settings, m_Version: 8 }),
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

  // Mission scheduling: separate file/endpoint, so its own updater, dirty-state and save.
  const updateMission = (key: string, value: any) => setMissionSettings({ ...missionSettings, [key]: value });

  const missionDirty = useMemo(
    () => JSON.stringify(missionSettings) !== JSON.stringify(savedMissionSettings),
    [missionSettings, savedMissionSettings]
  );

  const saveScheduling = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/expansion/mission-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
        body: JSON.stringify({ ...missionSettings, m_Version: 2 }),
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
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left column — global airdrop settings (AirdropSettings.json) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Global Settings</h3>
            <Button variant="primary" icon={Save01} onClick={save} disabled={!isDirty}>Save Core Settings</Button>
          </div>
          <div className="p-4 space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
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

        {/* Right column — mission scheduling (MissionSettings.json) */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Mission Scheduling</h3>
              <p className="text-sm text-gray-500 mt-1">
                Airdrops are the only Expansion mission type, so these settings control when and how
                often airdrops spawn. Stored in <code>MissionSettings.json</code>.
              </p>
            </div>
            <Button variant="primary" icon={Save01} onClick={saveScheduling} disabled={!missionDirty}>Save Scheduling</Button>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 p-4 space-y-4">
            {MISSION_BOOL_FIELDS.map(({ key, label }) => (
              <Toggle key={key} label={label} isSelected={!!missionSettings?.[key]} onChange={(v) => updateMission(key, v ? 1 : 0)} />
            ))}
            <div className="grid grid-cols-2 gap-4">
              {MISSION_NUMERIC_FIELDS.map(({ key, label, ms }) => {
                const raw = missionSettings?.[key];
                return (
                  <Input key={key} size="sm" label={label} type="number" suffix={ms ? 'sec' : undefined}
                    hint={ms ? formatMs(Number(raw ?? 0)) : undefined}
                    value={ms ? (raw != null && raw !== '' ? Number(raw) / 1000 : '') : (raw ?? '')}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      updateMission(key, ms ? Math.round(n * 1000) : n);
                    }} />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Deep-clone a native Expansion Loot[] so a copied/linked list can't alias the stored one.
const cloneLoot = (loot: any[]): any[] => JSON.parse(JSON.stringify(loot || []));

interface LootConnectorProps {
  targetType: 'container' | 'mission';
  targetKey: string;                  // container ClassName or mission file name
  loot: any[];                        // the target's current Loot[]
  onChangeLoot: (loot: any[]) => void;
  lootLists: LootList[];
  lootLinks: LootListLink[];
  persistLootLinks: (next: LootListLink[]) => void | Promise<void>;
  setTab: (t: TabId) => void;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  editorKey: string;                  // remount key (target identity)
  linkOnly?: boolean;                 // missions: reference a list (live link) only — no copy, no inline editing
}

/**
 * Wraps the loot editor for a container/mission with Loot-List connection. When the
 * target is linked to a list, the editor is replaced by a read-only banner (the list is
 * the source of truth — edit it in the Loot Lists tab). Otherwise:
 *  - default (containers): the inline editor plus a picker offering "Copy in" or "Link".
 *  - linkOnly (missions): only a list picker that live-links the chosen list; custom loot
 *    is authored in the Loot Lists tab, not inline on the mission.
 */
const LootConnector: React.FC<LootConnectorProps> = ({
  targetType, targetKey, loot, onChangeLoot, lootLists, lootLinks, persistLootLinks,
  setTab, typeOptions, randomPresets, loadouts, editorKey, linkOnly = false,
}) => {
  const link = lootLinks.find((l) => l.targetType === targetType && l.targetKey === targetKey);
  const linkedList = link ? lootLists.find((ll) => ll.id === link.listId) : undefined;
  const [pickListId, setPickListId] = useState<string>('');
  // Bumped on "Copy in" to remount AirdropLootEditor so it re-seeds from the new loot.
  const [copyNonce, setCopyNonce] = useState(0);

  if (link) {
    const preview = (loot || []).map((x) => x?.Name).filter(Boolean);
    // Remove the link record. For containers the copied loot is kept (becomes editable
    // inline); for missions (linkOnly) it's kept too, so the picker reappears to choose
    // another list. Turning unique loot fully off on a mission is done via its toggle.
    const removeLink = () =>
      persistLootLinks(lootLinks.filter((l) => !(l.targetType === targetType && l.targetKey === targetKey)));
    return (
      <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/40 dark:bg-primary-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-primary-700 dark:text-primary-300">
            <Link01 size={16} />
            {linkedList ? <>Linked to «{linkedList.Name}»</> : <>Linked to a deleted list</>}
          </span>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="secondary-gray" icon={LayersThree01} onClick={() => setTab('lootlists')}>
              Edit in Loot Lists
            </Button>
            <Button size="xs" variant="secondary-gray" icon={LinkBroken01} onClick={removeLink}>
              {linkOnly ? 'Change list' : 'Unlink'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          This {targetType === 'container' ? 'container' : 'mission'} uses a shared loot list. Its loot is
          read-only here and re-flattened from the list when you save the Loot Lists tab.
          {linkOnly ? ' Use “Change list” to reference a different one.' : ' Unlink to edit inline (the current loot is kept).'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {preview.length === 0 ? (
            <span className="text-xs text-gray-400">List has no loot yet.</span>
          ) : (
            <>
              {preview.slice(0, 16).map((n, i) => (
                <span key={i} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">{n}</span>
              ))}
              {preview.length > 16 && <span className="text-[11px] text-gray-400 self-center">+{preview.length - 16} more</span>}
            </>
          )}
        </div>
      </div>
    );
  }

  const applyList = (mode: 'copy' | 'link') => {
    const list = lootLists.find((ll) => ll.id === pickListId);
    if (!list) return;
    onChangeLoot(cloneLoot(list.Loot));
    setCopyNonce((n) => n + 1);
    if (mode === 'link') {
      persistLootLinks([...lootLinks, { listId: list.id, targetType, targetKey }]);
    }
    setPickListId('');
  };

  // Missions reference a custom list (live link only) — no copy, no inline editing.
  if (linkOnly) {
    if (lootLists.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">No loot lists exist yet. Create one in the Loot Lists tab, then reference it here.</p>
          <Button size="sm" variant="secondary-gray" icon={LayersThree01} onClick={() => setTab('lootlists')}>Open Loot Lists</Button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3">
        <div className="min-w-[240px]">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Reference a Loot List</label>
          <ComboBox aria-label="Reference a Loot List" items={lootLists.map((ll) => ({ id: ll.id, label: `${ll.Name} · ${ll.Loot.length}` }))}
            selectedKey={pickListId || null}
            onSelectionChange={(k) => setPickListId(k ? String(k) : '')}>
            {(item: { id: string; label: string }) => <ComboBoxItem id={item.id}>{item.label}</ComboBoxItem>}
          </ComboBox>
        </div>
        <Button size="sm" variant="primary" icon={Link01} disabled={!pickListId} onClick={() => applyList('link')}>Link list</Button>
        <span className="text-[11px] text-gray-400 basis-full">The mission's loot stays in sync with this list on save. Edit the loot in the Loot Lists tab.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lootLists.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3">
          <div className="min-w-[220px]">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Use a Loot List</label>
            <ComboBox aria-label="Use a Loot List" items={lootLists.map((ll) => ({ id: ll.id, label: `${ll.Name} · ${ll.Loot.length}` }))}
              selectedKey={pickListId || null}
              onSelectionChange={(k) => setPickListId(k ? String(k) : '')}>
              {(item: { id: string; label: string }) => <ComboBoxItem id={item.id}>{item.label}</ComboBoxItem>}
            </ComboBox>
          </div>
          <Button size="sm" variant="secondary-gray" icon={Copy01} disabled={!pickListId} onClick={() => applyList('copy')}>Copy in</Button>
          <Button size="sm" variant="secondary-gray" icon={Link01} disabled={!pickListId} onClick={() => applyList('link')}>Link</Button>
          <span className="text-[11px] text-gray-400 basis-full">Copy = one-time snapshot. Link = stays in sync with the list on save (loot becomes read-only here).</span>
        </div>
      )}
      <AirdropLootEditor
        key={`${editorKey}-${copyNonce}`}
        initialLoot={loot}
        onChange={onChangeLoot}
        typeOptions={typeOptions}
        randomPresets={randomPresets}
        loadouts={loadouts}
      />
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
  lootLists: LootList[];
  lootLinks: LootListLink[];
  persistLootLinks: (next: LootListLink[]) => void | Promise<void>;
  setTab: (t: TabId) => void;
}

const ContainersTab: React.FC<ContainersTabProps> = ({
  settings, setSettings, selectedContainerIdx, setSelectedContainerIdx,
  typeOptions, randomPresets, loadouts, selectedProfileId, setSaveState,
  savedSettings, setSavedSettings, customInfected,
  lootLists, lootLinks, persistLootLinks, setTab,
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
    // Prune any loot-list link that targeted this container class (link key = ClassName).
    const cls = containers[idx]?.Container;
    if (cls && lootLinks.some((l) => l.targetType === 'container' && l.targetKey === cls)) {
      persistLootLinks(lootLinks.filter((l) => !(l.targetType === 'container' && l.targetKey === cls)));
    }
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
        // Always stamp the current schema version so the mod never runs its legacy
        // migration converters against our current-shape data.
        body: JSON.stringify({ ...settings, m_Version: 8 }),
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
              <LootConnector
                targetType="container"
                targetKey={selected.Container}
                editorKey={`container-${selectedContainerIdx}`}
                loot={selected.Loot || []}
                onChangeLoot={(loot) => updateContainer(selectedContainerIdx!, { Loot: loot })}
                lootLists={lootLists}
                lootLinks={lootLinks}
                persistLootLinks={persistLootLinks}
                setTab={setTab}
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
          return u ? { ...m, data: u.data, savedData: JSON.parse(JSON.stringify(u.data)) } : m;
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

interface LootListsTabProps {
  lootLists: LootList[];
  setLootLists: React.Dispatch<React.SetStateAction<LootList[]>>;
  savedLootLists: LootList[];
  setSavedLootLists: (l: LootList[]) => void;
  lootLinks: LootListLink[];
  savedLootLinks: LootListLink[];
  setSavedLootLinks: (l: LootListLink[]) => void;
  selectedLootListIdx: number | null;
  setSelectedLootListIdx: (i: number | null) => void;
  settings: any;
  setSettings: (s: any) => void;
  setSavedSettings: (s: any) => void;
  missions: { file: string; data: any }[];
  setMissions: React.Dispatch<React.SetStateAction<{ file: string; data: any }[]>>;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
  selectedProfileId: string;
  setSaveState: (s: SaveState) => void;
}

// Lootmaster-owned reusable loot-list library. A list stores a native Expansion Loot[]
// (see LootList) that containers/missions consume by copy or live link. On save, every
// linked target's Loot[] is re-flattened from its list (Expansion always inlines loot).
const LootListsTab: React.FC<LootListsTabProps> = ({
  lootLists, setLootLists, savedLootLists, setSavedLootLists,
  lootLinks, savedLootLinks, setSavedLootLinks,
  selectedLootListIdx, setSelectedLootListIdx,
  settings, setSettings, setSavedSettings, missions, setMissions,
  typeOptions, randomPresets, loadouts, selectedProfileId, setSaveState,
}) => {
  const selected = selectedLootListIdx !== null ? lootLists[selectedLootListIdx] : null;
  const containers: any[] = useMemo(() => settings?.Containers || [], [settings]);

  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState('empty');

  const isDirty = useMemo(
    () => JSON.stringify({ lists: lootLists, links: lootLinks }) !== JSON.stringify({ lists: savedLootLists, links: savedLootLinks }),
    [lootLists, lootLinks, savedLootLists, savedLootLinks]
  );

  const linkCount = (list: LootList) => lootLinks.filter((l) => l.listId === list.id).length;

  const updateList = (patch: Partial<LootList>) => {
    if (selectedLootListIdx === null) return;
    setLootLists(lootLists.map((l, i) => (i === selectedLootListIdx ? { ...l, ...patch } : l)));
  };

  const sourceOptions = useMemo(() => [
    { value: 'empty', label: 'Empty list' },
    ...containers.map((c: any) => ({ value: `container:${c.Container}`, label: `From container: ${c.Container} (${c.Loot?.length || 0})` })),
    ...lootLists.map((ll) => ({ value: `list:${ll.id}`, label: `From list: ${ll.Name} (${ll.Loot.length})` })),
  ], [containers, lootLists]);

  const createList = () => {
    let Loot: any[] = [];
    let name = newName.trim();
    if (newSource.startsWith('container:')) {
      const cls = newSource.slice('container:'.length);
      Loot = cloneLoot(containers.find((c: any) => c.Container === cls)?.Loot || []);
      if (!name) name = `${cls} Loot`;
    } else if (newSource.startsWith('list:')) {
      const src = lootLists.find((ll) => ll.id === newSource.slice('list:'.length));
      Loot = cloneLoot(src?.Loot || []);
      if (!name) name = `${src?.Name || 'List'} Copy`;
    }
    if (!name) name = `Loot List ${lootLists.length + 1}`;
    setLootLists([...lootLists, { id: genLootListId(), Name: name, Loot }]);
    setSelectedLootListIdx(lootLists.length);
    setModalOpen(false);
    setNewName('');
    setNewSource('empty');
  };

  const duplicateList = (idx: number) => {
    const src = lootLists[idx];
    setLootLists([...lootLists, { id: genLootListId(), Name: `${src.Name} Copy`, Loot: cloneLoot(src.Loot) }]);
    setSelectedLootListIdx(lootLists.length);
  };

  const deleteList = (idx: number) => {
    const list = lootLists[idx];
    const links = lootLinks.filter((l) => l.listId === list.id);
    if (links.length > 0) {
      const names = links.map((l) => `  • ${l.targetType}: ${l.targetKey}`).join('\n');
      window.alert(
        `Can't delete «${list.Name}» — ${links.length} linked target${links.length === 1 ? '' : 's'} still use it:\n\n${names}\n\nUnlink them first (in the Containers/Missions tab), then delete.`
      );
      return;
    }
    setLootLists(lootLists.filter((_, i) => i !== idx));
    const nextIdx =
      selectedLootListIdx === null || selectedLootListIdx === idx ? null
        : selectedLootListIdx > idx ? selectedLootListIdx - 1
          : selectedLootListIdx;
    setSelectedLootListIdx(nextIdx);
  };

  const save = async () => {
    setSaveState({ kind: 'saving' });
    try {
      // 1) Persist the library sidecar (lists + links).
      await putLootLists(selectedProfileId, lootLists, lootLinks);

      // 2) Live-sync: re-flatten each list's loot into its linked targets. Only targets
      //    whose on-disk loot actually differs are rewritten.
      const listById = new Map(lootLists.map((l) => [l.id, l]));
      const changedContainers: string[] = [];
      const nextContainers = containers.map((c: any) => {
        const link = lootLinks.find((l) => l.targetType === 'container' && l.targetKey === c.Container);
        const list = link && listById.get(link.listId);
        if (list && JSON.stringify(c.Loot || []) !== JSON.stringify(list.Loot)) {
          changedContainers.push(c.Container);
          return { ...c, Loot: cloneLoot(list.Loot) };
        }
        return c;
      });
      const missionUpdates: { file: string; data: any }[] = [];
      for (const m of missions) {
        if ((m as any).corrupt || (m as any).isNew) continue;
        const link = lootLinks.find((l) => l.targetType === 'mission' && l.targetKey === m.file);
        const list = link && listById.get(link.listId);
        if (list && JSON.stringify(m.data?.Loot || []) !== JSON.stringify(list.Loot)) {
          missionUpdates.push({ file: m.file, data: { ...m.data, Loot: cloneLoot(list.Loot) } });
        }
      }

      // A live link means the target's on-disk loot must always mirror its list, so
      // propagate unconditionally on save — no cancellable prompt (a cancel used to leave
      // linked missions/containers stale on disk while still marking the tab "Saved").
      const changeCount = changedContainers.length + missionUpdates.length;
      if (changeCount > 0) {
        if (changedContainers.length > 0) {
          const nextSettings = { ...settings, Containers: nextContainers };
          const res = await apiFetch(`/api/expansion/airdrop-settings`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            profileId: selectedProfileId, body: JSON.stringify(nextSettings),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Failed to update containers');
          setSettings(nextSettings);
          setSavedSettings(nextSettings);
        }
        if (missionUpdates.length > 0) {
          await Promise.all(missionUpdates.map((u) =>
            apiFetch(`/api/expansion/airdrop-missions?file=${encodeURIComponent(u.file)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              profileId: selectedProfileId, body: JSON.stringify(u.data),
            })
          ));
          setMissions((prev) => prev.map((m) => {
            const u = missionUpdates.find((x) => x.file === m.file);
            return u ? { ...m, data: u.data, savedData: JSON.parse(JSON.stringify(u.data)) } : m;
          }));
        }
      }

      setSavedLootLists(lootLists);
      setSavedLootLinks(lootLinks);
      setSaveState({ kind: 'ok' });
      setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
    } catch (e: any) {
      setSaveState({ kind: 'error', message: e.message });
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Loot Lists</span>
          <Button size="xs" variant="secondary-gray" icon={Plus} onClick={() => { setNewName(''); setNewSource('empty'); setModalOpen(true); }} />
        </div>
        <div className="p-2 space-y-1">
          {lootLists.length === 0 && (
            <p className="p-3 text-xs text-gray-400">No loot lists yet. Click + to create a reusable list from a container or from scratch.</p>
          )}
          {lootLists.map((list, i) => {
            const links = linkCount(list);
            return (
              <button key={list.id} onClick={() => setSelectedLootListIdx(i)}
                className={cx('w-full text-left p-3 rounded-lg border transition-all',
                  selectedLootListIdx === i ? 'bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm'
                    : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate min-w-0 flex-1">{list.Name || 'Unnamed'}</span>
                  <Badge size="sm" color="gray">{list.Loot.length}</Badge>
                </div>
                <span className="text-xs text-gray-400 truncate block">
                  {links > 0 ? `Linked to ${links} target${links === 1 ? '' : 's'}` : 'Not linked'}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Loot Lists</h3>
            <p className="text-sm text-gray-500 max-w-xl">
              Reusable loot tables. Attach one to a container or mission from the
              <span className="font-medium"> Containers</span> / <span className="font-medium">Missions</span> tabs
              as a copy or a live link; saving here re-flattens linked loot into every target.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selected && (
              <>
                <Button variant="secondary-gray" icon={Copy01} onClick={() => duplicateList(selectedLootListIdx!)}>Duplicate</Button>
                <Button variant="error-secondary" icon={Trash01} onClick={() => deleteList(selectedLootListIdx!)}>Delete</Button>
              </>
            )}
            <Button variant="primary" icon={Save01} onClick={save} disabled={!isDirty}>Save Loot Lists</Button>
          </div>
        </div>

        {selected ? (
          <div className="space-y-6 max-w-5xl">
            <div className="grid grid-cols-2 gap-4">
              <Input label="List Name" value={selected.Name} onChange={(e) => updateList({ Name: e.target.value })} />
              <div className="flex items-end pb-2">
                <p className="text-xs text-gray-400">
                  {linkCount(selected) > 0
                    ? `Linked to ${linkCount(selected)} target${linkCount(selected) === 1 ? '' : 's'} — saving updates them on disk.`
                    : 'Not linked to any container or mission yet.'}
                </p>
              </div>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-800 pt-6">
              <AirdropLootEditor
                key={selected.id}
                initialLoot={selected.Loot}
                onChange={(loot) => updateList({ Loot: loot })}
                typeOptions={typeOptions}
                randomPresets={randomPresets}
                loadouts={loadouts}
              />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <LayersThree01 size={48} className="text-gray-200 mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Select a loot list</h3>
            <p className="text-sm text-gray-500 max-w-xs">Choose a list to edit, or click + to create one from a core container or from scratch.</p>
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Loot List" maxWidth="max-w-md">
          <div className="space-y-4">
            <Input label="Name" placeholder="(auto-named from source)" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <Select label="Start from" options={sourceOptions} value={newSource} onChange={(e) => setNewSource(e.target.value)} />
            <p className="text-xs text-gray-500">
              Copying a container or another list snapshots its loot; the new list is fully independent afterwards.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary-gray" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" icon={Plus} onClick={createList}>Create</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// A config whose Infected list can be copied into another (other missions / core
// containers). `values` is the source Infected classname list.
interface InfectedCopySource { key: string; label: string; values: string[] }

// Split an Infected list into infected (Zmb*) vs Expansion-AI (eAI_*) counts for the
// copy-source hint. eAI classnames are prefixed `eAI_`; everything else is a zombie.
const infectedTotals = (list: string[]): { infected: number; ai: number } => {
  let infected = 0, ai = 0;
  for (const n of list) {
    if (n.toLowerCase().startsWith('eai')) ai++; else infected++;
  }
  return { infected, ai };
};

// "5 infected · 2 AI" — omits a zero side; used in copy-source option labels.
const infectedSummary = (list: string[]): string => {
  const { infected, ai } = infectedTotals(list);
  const parts: string[] = [];
  if (infected) parts.push(`${infected} infected`);
  if (ai) parts.push(`${ai} AI`);
  return parts.join(' · ') || 'empty';
};

const InfectedList: React.FC<{ values: string[]; onChange: (v: string[]) => void; customInfected?: string[]; copySources?: InfectedCopySource[] }> = ({ values, onChange, customInfected = [], copySources = [] }) => {
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
          {copySources.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 shrink-0">Copy from</span>
              <Select
                size="sm"
                aria-label="Copy Infected / AI list from another mission or container"
                value=""
                options={[
                  { value: '', label: 'another mission or container…' },
                  ...copySources.map((s) => ({ value: s.key, label: `${s.label} — ${infectedSummary(s.values)}` })),
                ]}
                onChange={(e) => {
                  const src = copySources.find((s) => s.key === e.target.value);
                  if (src) onChange([...src.values]);
                }}
              />
            </div>
          )}
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

// `savedData` is a deep snapshot of `data` as it was last persisted (on load, save,
// or a propagation push). The Missions Save button diffs `data` against it to gate
// on dirtiness; a new mission has no snapshot so it always reads dirty.
interface Mission { file: string; data: any; savedData?: any; isNew?: boolean; corrupt?: boolean; parseError?: string; }

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
    const normalized = { ...data, DropLocation: drop };
    return { file, data: normalized, savedData: JSON.parse(JSON.stringify(normalized)) } as Mission;
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
  lootLists: LootList[];
  lootLinks: LootListLink[];
  persistLootLinks: (next: LootListLink[]) => void | Promise<void>;
  setTab: (t: TabId) => void;
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

// Sidebar display for a mission's Container: show only the part after the shared
// "ExpansionAirdropContainer" prefix (e.g. "ExpansionAirdropContainer_Medical" →
// "Medical"). Non-Expansion values (e.g. "Random") and the bare prefix pass through.
const shortContainerName = (name?: string): string => {
  if (!name) return '—';
  const stripped = name.replace(/^ExpansionAirdropContainer[_-]?/i, '');
  return stripped || name;
};

// Derive an `Airdrop_<MinifiedLocation>.json` file name, suffixing with `_<n>`
// (_2, _3, …) when another mission already uses that file. `excludeIdx` skips the
// mission being renamed so it doesn't collide with itself.
const fileNameForLocation = (locName: string, missions: Mission[], excludeIdx: number): string => {
  const base = minifyName(locName) || 'Drop';
  const taken = new Set(missions.filter((_, i) => i !== excludeIdx).map((m) => m.file.toLowerCase()));
  let name = `Airdrop_${base}.json`;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `Airdrop_${base}_${n++}.json`;
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
  lootLists, lootLinks, persistLootLinks, setTab,
}) => {
  const mission = selectedMissionIdx !== null ? missions[selectedMissionIdx] : null;

  // A mission is dirty (Save enabled) when it's new/unsaved or its data has diverged
  // from the last-persisted snapshot. Corrupt files have no editor, so never dirty.
  const missionDirty = useMemo(
    () => !!mission && !mission.corrupt &&
      (!!mission.isNew || JSON.stringify(mission.data) !== JSON.stringify(mission.savedData)),
    [mission]
  );

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
    // Carry a loot-list link onto the copy (keyed by file name) so the duplicate stays
    // linked rather than stranding the copied inline loot.
    const srcLink = lootLinks.find((l) => l.targetType === 'mission' && l.targetKey === src.file);
    if (srcLink) persistLootLinks([...lootLinks, { listId: srcLink.listId, targetType: 'mission', targetKey: name }]);
  };

  const saveMission = async () => {
    if (!mission) return;
    // Expansion allows one DropLocation per mission file, written as a single
    // object (ref ExpansionAirdropLocation) — the canonical Expansion shape.
    const dl = mission.data.DropLocation;
    const drop = Array.isArray(dl) ? dl[0] : dl;
    if (!drop) {
      setSaveState({ kind: 'error', message: 'Set a drop location' });
      return;
    }
    // Mission files are named automatically from the drop location on first save:
    // Airdrop_<MinifiedLocation>[_n].json. Already-saved files keep their on-disk
    // name so we never orphan a file.
    const targetFile = mission.isNew
      ? fileNameForLocation(drop.Name || '', missions, selectedMissionIdx ?? -1)
      : mission.file;
    if (!isValidMissionFile(targetFile)) {
      setSaveState({ kind: 'error', message: 'File must match Airdrop_*.json' });
      return;
    }

    setSaveState({ kind: 'saving' });
    // The exact shape written to disk: current schema version + single-object DropLocation.
    const savedShape = { ...mission.data, m_Version: 3, DropLocation: drop };
    try {
      const res = await apiFetch(`/api/expansion/airdrop-missions?file=${encodeURIComponent(targetFile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
        body: JSON.stringify(savedShape),
      });
      if (!res.ok) throw new Error((await res.json()).error || `Failed to save ${targetFile}`);
      // If auto-naming renamed the file, migrate any loot-list link that was keyed on
      // the placeholder name so the mission keeps its unique loot.
      if (mission.isNew && targetFile !== mission.file &&
          lootLinks.some((l) => l.targetType === 'mission' && l.targetKey === mission.file)) {
        persistLootLinks(lootLinks.map((l) =>
          l.targetType === 'mission' && l.targetKey === mission.file ? { ...l, targetKey: targetFile } : l));
      }
      // Sync in-memory data to the persisted shape and snapshot it so the Save
      // button reads clean until the next edit.
      patchMission({ file: targetFile, isNew: false, data: savedShape, savedData: JSON.parse(JSON.stringify(savedShape)) });
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
    // Prune any loot-list link that targeted this mission file so it can't resurrect loot.
    if (lootLinks.some((l) => l.targetType === 'mission' && l.targetKey === m.file)) {
      persistLootLinks(lootLinks.filter((l) => !(l.targetType === 'mission' && l.targetKey === m.file)));
    }
    setMissions((prev) => prev.filter((_, i) => i !== idx));
    setSelectedMissionIdx(null);
  };

  // Unique loot is decoupled from the Container field: a mission ALWAYS has a Container
  // (a core container class or "Random"), and "unique loot" means it references a custom
  // list from the Loot Lists tab instead of inheriting that container's core loot. So
  // uniqueness is driven by the loot-list link (not by which container is selected).
  const missionLink = mission && !mission.corrupt
    ? lootLinks.find((l) => l.targetType === 'mission' && l.targetKey === mission.file)
    : undefined;
  // Local flag so toggling "unique loot" on reveals the list picker before a list is
  // chosen (there's no link/loot yet at that instant). Reset when switching missions.
  const [expandUnique, setExpandUnique] = useState(false);
  useEffect(() => { setExpandUnique(false); }, [selectedMissionIdx]);
  const isUnique = mission && !mission.corrupt
    ? (!!missionLink || (mission.data.Loot || []).length > 0 || expandUnique)
    : false;

  const setMode = (unique: boolean) => {
    if (!mission) return;
    if (unique) {
      // Reveal the loot-list picker. Container is independent — leave it untouched.
      setExpandUnique(true);
    } else {
      // Back to inheriting the container's core loot: drop the link and clear the loot.
      setExpandUnique(false);
      if (missionLink) {
        persistLootLinks(lootLinks.filter((l) => !(l.targetType === 'mission' && l.targetKey === mission.file)));
      }
      patchData({ Loot: [] });
    }
  };

  const dl = mission?.data?.DropLocation;
  const drop: DropLocation | null = (Array.isArray(dl) ? dl[0] : dl) || null;

  // Unsaved missions are auto-named from the drop location (finalized on first save);
  // this is the read-only preview of that name. Saved missions show their on-disk file.
  const previewFile = mission && mission.isNew && !mission.corrupt
    ? fileNameForLocation(drop?.Name || '', missions, selectedMissionIdx ?? -1)
    : mission?.file ?? '';

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
    // With unique loot the container only supplies the crate model (its loot is
    // overridden by the custom list), so any Expansion crate type is valid — offer the
    // full set. Without it the mission inherits the container's core loot, so it must
    // stay restricted to the containers configured in the Containers tab.
    if (isUnique) CONTAINER_CLASS_OPTIONS.forEach((c) => set.add(c));
    if (mission?.data?.Container) set.add(mission.data.Container);
    return Array.from(set).map((c) => ({ id: c }));
  }, [containerNames, mission?.data?.Container, isUnique]);

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

  // Sources the Infected/AI list can be copied from: every OTHER mission plus each
  // core-settings container that has infected configured. Empty lists are skipped
  // (nothing to copy); each carries its zombie/AI totals for the picker hint.
  const infectedCopySources = useMemo(() => {
    const sources: InfectedCopySource[] = [];
    missions.forEach((m, i) => {
      if (i === selectedMissionIdx || m.corrupt) return;
      const vals: string[] = m.data?.Infected || [];
      if (vals.length) sources.push({ key: `m:${m.file}`, label: `Mission: ${m.data?.MissionName?.trim() || m.file}`, values: vals });
    });
    (settings?.Containers || []).forEach((c: any, i: number) => {
      const vals: string[] = c?.Infected || [];
      if (vals.length) sources.push({ key: `c:${i}`, label: `Container: ${c?.Container || `#${i + 1}`}`, values: vals });
    });
    return sources;
  }, [missions, selectedMissionIdx, settings]);

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
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate block">{shortContainerName(m.data?.Container)}</span>
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
                <Input label="File Name" value={previewFile} disabled
                  hint={mission.isNew ? 'Auto-named from the drop location; set on first save.' : undefined} />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Button variant="secondary-gray" icon={Copy01} onClick={() => duplicateMission(selectedMissionIdx!)}>Duplicate</Button>
                <Button variant="error-secondary" icon={Trash01} onClick={() => deleteMission(selectedMissionIdx!)}>Delete</Button>
                <Button variant="primary" icon={Save01} onClick={saveMission} disabled={!missionDirty}>Save</Button>
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
              <Toggle label="Unique loot (use a custom list)" isSelected={isUnique} onChange={setMode} />
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-lg">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Container</label>
                <ComboBox aria-label="Container" items={containerOptions}
                  selectedKey={mission.data.Container ?? 'Random'}
                  onSelectionChange={(k) => k && patchData({ Container: String(k) })}>
                  {(item: { id: string }) => <ComboBoxItem id={item.id}>{item.id}</ComboBoxItem>}
                </ComboBox>
                <p className="text-xs text-gray-400 mt-1">
                  The core container this drop uses (its crate — and, unless unique loot is set, its loot). "Random" picks one at spawn.
                  {isUnique && ' With unique loot, any crate type can be picked.'}
                </p>
              </div>
              <Input label="Airdrop Plane Class" placeholder="(inherit from settings)"
                value={mission.data.AirdropPlaneClassName ?? ''} onChange={(e) => patchData({ AirdropPlaneClassName: e.target.value })} />
            </div>

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

            <InfectedList values={mission.data.Infected || []} customInfected={map.customInfected} copySources={infectedCopySources} onChange={(v) => patchData({ Infected: v })} />

            {isUnique && (
              <div className="border-t border-gray-100 dark:border-gray-800 pt-6 space-y-3">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                    <LayersThree01 size={14} /> Unique Loot
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    This mission uses a custom loot list instead of {mission.data.Container && mission.data.Container !== 'Random' ? `«${mission.data.Container}»'s` : 'the container'} core loot.
                  </p>
                </div>
                <LootConnector
                  targetType="mission"
                  targetKey={mission.file}
                  editorKey={`mission-${selectedMissionIdx}`}
                  loot={mission.data.Loot || []}
                  onChangeLoot={(loot) => patchData({ Loot: loot })}
                  lootLists={lootLists}
                  lootLinks={lootLinks}
                  persistLootLinks={persistLootLinks}
                  setTab={setTab}
                  typeOptions={typeOptions}
                  randomPresets={randomPresets}
                  loadouts={loadouts}
                  linkOnly
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
