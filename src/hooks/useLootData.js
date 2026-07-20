import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseEconomyCoreXml,
  parseGlobalsXml,
  parseLimitsXml,
  parseRandomPresetsXml,
  parseSpawnableTypesXml,
  ROOT_SPAWNABLE_GROUP,
  parseTypesXml,
  generateTypesXml,
  generateLimitsXml,
  generateSpawnableTypesXml,
  generateRandomPresetsXml
} from '../utils/xml.js';
import { getApiBase, apiFetch } from '../utils/api';
import { loadFromStorage, saveToStorage } from '../utils/storage.js';
import { appendChangeLogs, loadAllGrouped, saveManyTypeFiles, clearAllTypeFiles, clearChangeLog, saveMissionFile, loadMissionFile } from '../utils/idb.js';
import { loadAllLoadouts } from '../utils/loadoutStore.js';
import { createHistory } from '../utils/history.js';
import { validateUnknowns } from '../utils/validation.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * Grouped storage structure
 * @typedef {Record<string, Type[]>} TypeGroups
 */

/**
 * File-level storage structure (group -> fileBase -> types[])
 * @typedef {Record<string, Record<string, Type[]>>} TypeFiles
 */

const STORAGE_KEY_GROUPS = 'dayz-types-editor:lootGroups';
const LEGACY_STORAGE_KEY_TYPES = 'dayz-types-editor:lootTypes';
const STORAGE_KEY_SUMMARY_SHOWN = 'dayz-types-editor:summaryShown';

/**
 * Hook to load limits and grouped types, manage filters/selection, persistence, history, and unknown entries flow.
 */
export function useLootData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(/** @type {Error | string | null} */(null));
  const [definitions, setDefinitions] = useState(/** @type {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}|null} */(null));

  // File-level persisted structure: group -> file -> types
  const [lootFiles, setLootFiles] = useState(/** @type {TypeFiles|null} */(null));
  // Derived grouped structure for convenience (combined per group)
  // Only the setter is used: the group list the UI consumes is `groupsList` (derived from
  // lootFiles). setLootGroups is retained for its callers; the value itself is never read.
  const [, setLootGroups] = useState(/** @type {TypeGroups|null} */(null));
  // Merged array view with metadata for UI (each element augmented with "group" and source file)
  const [lootTypes, _setLootTypes] = useState(/** @type {(Type & {group: string, file: string})[]|null} */(null));
  // Filters include groups selection
  const [filters, setFilters] = useState({
    category: 'all',
    name: '',
    searchIn: /** @type {('className'|'displayName')[]} */(['className', 'displayName']),
    usage: /** @type {string[]} */([]),
    value: /** @type {string[]} */([]),
    tag: /** @type {string[]} */([]),
    flags: /** @type {string[]} */([]),
    changeFilter: /** @type {'all'|'changed'|'unchanged'} */('all'),
    groups: /** @type {string[]} */([])
  });
  const [selection, setSelection] = useState(new Set());
  const [lastClickedId, setLastClickedId] = useState(/** @type {string | null} */(null));

  const historyRef = useRef(createHistory([]));

  const [unknowns, setUnknowns] = useState(makeUnknownsEmpty());

  // Warnings collected during loading (missing files, parse errors, etc.)
  const [loadWarnings, setLoadWarnings] = useState(/** @type {string[]} */([]));

  /**
   * Summary data computed after initial load.
   * Shape matches SummaryModal's `summary` prop (type/group/file counts + definition counts).
   * @type {[{typeCount: number, groupCount: number, fileCount: number, definitionCounts: {categories: number, usageflags: number, valueflags: number, tags: number}} | null, (next: any) => void]}
   */
  const [loadSummary, setLoadSummary] = useState(/** @type {{typeCount: number, groupCount: number, fileCount: number, definitionCounts: {categories: number, usageflags: number, valueflags: number, tags: number}}|null} */(null));
  const [summaryOpen, setSummaryOpen] = useState(false);


  // Baseline parsed from samples (read-only reference to compare against edits)
  const [baselineFiles, setBaselineFiles] = useState(/** @type {TypeFiles|null} */(null));
  const [baselineDefinitions, setBaselineDefinitions] = useState(/** @type {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}|null} */(null));
  const [spawnableFilesByGroup, setSpawnableFilesByGroup] = useState(/** @type {Record<string, string[]>} */({}));
  const [spawnableTypesByGroup, setSpawnableTypesByGroup] = useState(/** @type {Record<string, Record<string, any>>} */({}));
  const [baselineSpawnableTypesByGroup, setBaselineSpawnableTypesByGroup] = useState(/** @type {Record<string, Record<string, any>>} */({}));
  const [randomPresets, setRandomPresets] = useState(/** @type {{presets: any[]}} */({ presets: [] }));
  const [baselineRandomPresets, setBaselineRandomPresets] = useState(/** @type {{presets: any[]}} */({ presets: [] }));
  const [globalsDefaults, setGlobalsDefaults] = useState(/** @type {{LootDamageMin: number|null, LootDamageMax: number|null}} */({ LootDamageMin: null, LootDamageMax: null }));
  const [loadouts, setLoadouts] = useState(/** @type {any[]} */([]));

  const [profiles, setProfiles] = useState(/** @type {{id: string, name: string, serverPath: string, missionName: string, addons?: string[]}[]} */([]));
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState(localStorage.getItem('dayz-editor:selectedProfileId') || '');
  const selectedProfile = useMemo(() => profiles.find(p => p.id === selectedProfileId), [profiles, selectedProfileId]);

  useEffect(() => {
    if (spawnableTypesByGroup && Object.keys(spawnableTypesByGroup).length > 0) {
      void saveMissionFile('spawnableTypesByGroup', spawnableTypesByGroup);
    }
  }, [spawnableTypesByGroup]);

  useEffect(() => {
    if (randomPresets && randomPresets.presets?.length > 0) {
      void saveMissionFile('randomPresets', randomPresets);
    }
  }, [randomPresets]);

  useEffect(() => {
    // Loadouts are per-map; reload when the selected profile changes. Server is the source of
    // truth; degrade to an empty list if it's unreachable or no profile is selected.
    loadAllLoadouts(selectedProfileId).then(setLoadouts).catch(() => setLoadouts([]));
  }, [selectedProfileId]);

  useEffect(() => {
    if (selectedProfileId) {
      localStorage.setItem('dayz-editor:selectedProfileId', selectedProfileId);
    } else {
      localStorage.removeItem('dayz-editor:selectedProfileId');
    }
  }, [selectedProfileId]);

  const fetchWithProfile = useCallback((url, options = {}) =>
    apiFetch(url, { ...options, profileId: selectedProfileId }), [selectedProfileId]);

  const loadMissionFilesFromAPI = useCallback(async (API_BASE, filesInput, warnings = []) => {
    const filesByGroup = filesInput?.filesByGroup || filesInput;

    // Try to load from IndexedDB first
    const idbSpawnable = await loadMissionFile('spawnableTypesByGroup');
    const idbRandomPresets = await loadMissionFile('randomPresets');
    
    let nextSpawnable = idbSpawnable || {};
    let nextRandomPresets = idbRandomPresets || { presets: [] };

    // Migration: Handle old non-nested spawnable types structure in IndexedDB
    if (idbSpawnable) {
      let needsMigration = false;
      for (const group in idbSpawnable) {
        // Old structure was Record<string, { types: [] }>
        if (idbSpawnable[group] && Array.isArray(idbSpawnable[group].types)) {
          needsMigration = true;
          break;
        }
      }

      if (needsMigration) {
        const migrated = {};
        for (const group in idbSpawnable) {
          if (idbSpawnable[group] && Array.isArray(idbSpawnable[group].types)) {
            // Find first filename for this group from filesByGroup
            const groupFiles = filesByGroup?.[group] || [];
            let fileName = 'spawnabletypes.xml';
            if (Array.isArray(groupFiles) && groupFiles.length > 0) {
              fileName = groupFiles[0].split('/').pop();
            } else if (groupFiles && typeof groupFiles === 'object' && Object.keys(groupFiles).length > 0) {
              fileName = Object.keys(groupFiles)[0];
            }
            
            if (fileName && !fileName.toLowerCase().endsWith('.xml')) {
              fileName += '.xml';
            }
            
            migrated[group] = { [fileName || 'spawnabletypes.xml']: idbSpawnable[group] };
          } else {
            migrated[group] = idbSpawnable[group];
          }
        }
        nextSpawnable = migrated;
      }
    }

    // Ensure mission root spawnable types files are loaded if not in IDB
    if (!nextSpawnable[ROOT_SPAWNABLE_GROUP] || Object.keys(nextSpawnable[ROOT_SPAWNABLE_GROUP]).length === 0) {
      try {
        const rootFiles = ['cfgspawnabletypes.xml', 'cfgspawnabletype.xml'];
        if (!nextSpawnable[ROOT_SPAWNABLE_GROUP]) nextSpawnable[ROOT_SPAWNABLE_GROUP] = {};
        for (const f of rootFiles) {
          if (!nextSpawnable[ROOT_SPAWNABLE_GROUP][f]) {
            const res = await fetchWithProfile(`${API_BASE}/api/spawnabletypes/${encodeURIComponent(ROOT_SPAWNABLE_GROUP)}/${encodeURIComponent(f)}`);
            if (res.ok) {
              const text = await res.text();
              nextSpawnable[ROOT_SPAWNABLE_GROUP][f] = parseSpawnableTypesXml(text);
            }
          }
        }
      } catch (e) {
        warnings.push(`Mission root spawnabletypes: failed to parse XML (${String(e && e.message ? e.message : e)}).`);
      }
    }

    // Ensure all other groups and files from economycore are loaded if missing from IDB
    for (const [group, files] of Object.entries(filesByGroup || {})) {
      if (group === 'files' || group === 'lootTypes' || group === 'filesByGroup') continue;
      if (!nextSpawnable[group]) nextSpawnable[group] = {};
      
      const filesToProcess = Array.isArray(files) ? files : Object.keys(files);

      for (const f of filesToProcess) {
        try {
          let fileName = f.split('/').pop();
          if (!fileName.toLowerCase().endsWith('.xml')) fileName += '.xml';

          if (!nextSpawnable[group][fileName]) {
            const res = await fetchWithProfile(`${API_BASE}/api/spawnabletypes/${encodeURIComponent(group)}/${encodeURIComponent(fileName)}`);
            if (res.ok) {
              const text = await res.text();
              nextSpawnable[group][fileName] = parseSpawnableTypesXml(text);
            }
          }
        } catch (e) {
          warnings.push(`Group "${group}" file "${f}" spawnabletypes: failed to parse XML (${String(e && e.message ? e.message : e)}).`);
        }
      }
    }

    // If IDB is empty for presets, load from API
    if (!idbRandomPresets) {
      try {
        const res = await fetchWithProfile(`${API_BASE}/api/mission/randompresets`);
        if (res.ok) nextRandomPresets = parseRandomPresetsXml(await res.text());
      } catch (e) {
        warnings.push(`cfgrandompresets.xml: failed to parse XML (${String(e && e.message ? e.message : e)}).`);
      }
    }

    let nextGlobals = { LootDamageMin: null, LootDamageMax: null };
    try {
      const res = await fetchWithProfile(`${API_BASE}/api/mission/globals`);
      if (res.ok) nextGlobals = parseGlobalsXml(await res.text());
    } catch (e) {
      warnings.push(`globals.xml: failed to parse XML (${String(e && e.message ? e.message : e)}).`);
    }

    setSpawnableTypesByGroup(nextSpawnable);
    setBaselineSpawnableTypesByGroup(cloneJson(nextSpawnable));
    setRandomPresets(nextRandomPresets);
    setBaselineRandomPresets(cloneJson(nextRandomPresets));
    setGlobalsDefaults(nextGlobals);
  }, [fetchWithProfile]);

  const loadProfiles = useCallback(async () => {
    try {
      const API_BASE = getApiBase();
      const res = await fetch(`${API_BASE}/api/profiles`);
      if (res.ok) {
        const data = await res.json();
        setProfiles(data);
        
        const storedId = localStorage.getItem('dayz-editor:selectedProfileId');
        
        // If we have a selected ID but it's not in the returned data, reset it
        if (data.length === 0) {
          setSelectedProfileId('');
        } else if (selectedProfileId && !data.find(p => p.id === selectedProfileId)) {
          // If the currently held ID (from localStorage) is invalid, pick the first one
          setSelectedProfileId(data[0].id);
        } else if (!selectedProfileId && data.length > 0 && !storedId) {
          // If no profile selected but we have some, select first one if nothing was stored
          setSelectedProfileId(data[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load profiles:', e);
      setError(`Failed to connect to the backend server at ${getApiBase()}. Please ensure the server is running. (${e.message})`);
    } finally {
      setProfilesLoaded(true);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Refresh baseline (definitions + files) from live API
  const refreshBaselineFromAPI = useCallback(async () => {
    if (!profilesLoaded || !selectedProfileId) return false;
    try {
      const API_BASE = getApiBase();
      // Probe health
      let apiOk = false;
      try {
        const health = await fetchWithProfile(`${API_BASE}/api/health`);
        apiOk = health.ok;
      } catch {
        apiOk = false;
      }
      if (!apiOk) return false;

      // Definitions
      try {
        const limitsRes = await fetchWithProfile(`${API_BASE}/api/definitions`);
        if (limitsRes.ok) {
          const txt = await limitsRes.text();
          const defs = parseLimitsXml(txt);
          setBaselineDefinitions(defs);
        }
      } catch {
        // ignore defs baseline failures
      }

      /** @type {TypeFiles} */
      const baseline = {};

      // Vanilla
      try {
        const vr = await fetchWithProfile(`${API_BASE}/api/types/vanilla/types`);
        if (vr.ok) {
          const vText = await vr.text();
          let vanilla = parseTypesXml(vText);
          vanilla = vanilla.filter(t => {
            const n = t.name || '';
            const lower = n.toLowerCase();
            return !(n.startsWith('Land_') || n.startsWith('StaticObj_') || lower.startsWith('static_'));
          });
          baseline.vanilla = { types: vanilla };
        }
      } catch { /* ignore vanilla baseline failures */ }

      /** @type {Record<string, string[]>} */
      let sFilesWithRoot = {};
      // Additional groups via economycore
      try {
        const er = await fetchWithProfile(`${API_BASE}/api/economycore`);
        if (er.ok) {
          const eText = await er.text();
          const { order, filesByGroup, spawnableFilesByGroup: sFiles } = parseEconomyCoreXml(eText);
          
          // Ensure mission root spawnable types file is included in the map
          sFilesWithRoot = { ...sFiles };
          if (!sFilesWithRoot[ROOT_SPAWNABLE_GROUP]) {
            sFilesWithRoot[ROOT_SPAWNABLE_GROUP] = ['cfgspawnabletypes.xml'];
          }
          setSpawnableFilesByGroup(sFilesWithRoot);
          for (const group of order) {
            const filesList = filesByGroup[group] || [];
            if (filesList.length > 0) {
              for (const samplePath of filesList) {
                const parts = samplePath.split('/');
                const fileName = parts[parts.length - 1] || 'types.xml';
                const fileBase = fileName.replace(/\.xml$/i, '');
                try {
                  const tr = await fetchWithProfile(`${API_BASE}/api/types/${encodeURIComponent(group)}/${encodeURIComponent(fileBase)}`);
                  if (!tr.ok) continue;
                  const tText = await tr.text();
                  const parsed = parseTypesXml(tText);
                  if (!baseline[group]) baseline[group] = {};
                  baseline[group][fileBase] = parsed;
                } catch { /* skip */ }
              }
            } else if (sFilesWithRoot[group]) {
              // Ensure group exists in baseline even if no types files, so spawnabletypes are loaded.
              // Use the freshly-parsed sFilesWithRoot, not the spawnableFilesByGroup state, which is
              // still empty on first load (setSpawnableFilesByGroup above hasn't flushed yet).
              if (!baseline[group]) baseline[group] = {};
            }
          }
        }
      } catch { /* ignore */ }

      // Include vanilla_overrides/types in baseline if present so diffs clear after persisting overrides
      try {
        const or = await fetchWithProfile(`${API_BASE}/api/types/vanilla_overrides/types`);
        if (or.ok) {
          const oText = await or.text();
          const overrides = parseTypesXml(oText);
          if (!baseline['vanilla_overrides']) baseline['vanilla_overrides'] = {};
          baseline['vanilla_overrides']['types'] = overrides;
        }
      } catch { /* no overrides present */ }

      if (Object.keys(baseline).length > 0 || Object.keys(sFilesWithRoot).length > 0) {
        setBaselineFiles(baseline);
        await loadMissionFilesFromAPI(API_BASE, sFilesWithRoot, []);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [selectedProfileId, fetchWithProfile, loadMissionFilesFromAPI, profilesLoaded]);

  // Prefer baseline from live API to compare in storageDiff (initial load)
  useEffect(() => {
    let aborted = false;

    async function loadBaselineFromAPI() {
      try {
        const ok = await refreshBaselineFromAPI();
        if (!ok || aborted) return;
      } catch {
        // ignore API baseline failures
      }
    }

    loadBaselineFromAPI();
    return () => { aborted = true; };
  }, [refreshBaselineFromAPI]);

  const storageDiff = useMemo(() => {
    /** @type {{ definitions: { categories: boolean, usageflags: boolean, valueflags: boolean, tags: boolean }, files: Record<string, Record<string, { changed: boolean, added: number, removed: number, modified: number, changedCount: number, addedNames: string[], removedNames: string[], modifiedNames: string[], changedNames: string[] }>>, mission: { spawnableGroups: Record<string, Record<string, boolean>>, randomPresets: boolean } }} */
    const diff = {
      definitions: { categories: false, usageflags: false, valueflags: false, tags: false },
      files: {},
      mission: {
        spawnableGroups: {},
        randomPresets: false
      }
    };
    // Definitions compare
    if (baselineDefinitions && definitions) {
      const cmp = (a, b) => JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort());
      diff.definitions.categories = cmp(baselineDefinitions.categories, definitions.categories);
      diff.definitions.usageflags = cmp(baselineDefinitions.usageflags, definitions.usageflags);
      diff.definitions.valueflags = cmp(baselineDefinitions.valueflags, definitions.valueflags);
      diff.definitions.tags = cmp(baselineDefinitions.tags, definitions.tags);
    }
    // Files compare
    if (baselineFiles && lootFiles) {
      const allGroups = new Set([...Object.keys(baselineFiles), ...Object.keys(lootFiles)]);
      for (const g of allGroups) {
        const basePer = baselineFiles[g] || {};
        const currPer = lootFiles[g] || {};
        const allFiles = new Set([...Object.keys(basePer), ...Object.keys(currPer)]);
        for (const f of allFiles) {
          const baseArr = basePer[f] || [];
          const currArr = currPer[f] || [];
          const baseNames = new Set(baseArr.map(t => t.name));
          const currNames = new Set(currArr.map(t => t.name));
          const addedNames = [...currNames].filter(n => !baseNames.has(n));
          const removedNames = [...baseNames].filter(n => !currNames.has(n));

          // Modified: intersection where any field differs
          const normalize = (t) => ({
            name: t.name,
            category: t.category || null,
            nominal: t.nominal, min: t.min, lifetime: t.lifetime, restock: t.restock,
            quantmin: t.quantmin, quantmax: t.quantmax,
            flags: t.flags,
            usage: [...t.usage].sort(),
            value: [...t.value].sort(),
            tag: [...t.tag].sort(),
          });
          const baseByName = new Map(baseArr.map(t => [t.name, normalize(t)]));
          const currByName = new Map(currArr.map(t => [t.name, normalize(t)]));
          const modifiedNames = [];
          for (const name of [...baseNames].filter(n => currNames.has(n))) {
            const a = baseByName.get(name);
            const b = currByName.get(name);
            if (JSON.stringify(a) !== JSON.stringify(b)) modifiedNames.push(name);
          }

          const added = addedNames.length;
          const removed = removedNames.length;
          const modified = modifiedNames.length;

          const changedNames = [...new Set([...addedNames, ...modifiedNames])];
          const changedCount = added + removed + modified;
          const changed = changedCount > 0;

          if (!diff.files[g]) diff.files[g] = {};
          diff.files[g][f] = { changed, added, removed, modified, changedCount, addedNames, removedNames, modifiedNames, changedNames };
        }
      }
    }
    const allSpawnableGroups = new Set([...Object.keys(baselineSpawnableTypesByGroup), ...Object.keys(spawnableTypesByGroup)]);
    for (const group of allSpawnableGroups) {
      diff.mission.spawnableGroups[group] = {};
      const groupFiles = new Set([
        ...Object.keys(baselineSpawnableTypesByGroup[group] || {}),
        ...Object.keys(spawnableTypesByGroup[group] || {})
      ]);
      for (const file of groupFiles) {
        diff.mission.spawnableGroups[group][file] = JSON.stringify(baselineSpawnableTypesByGroup[group]?.[file] || { types: [] }) !== JSON.stringify(spawnableTypesByGroup[group]?.[file] || { types: [] });
      }
    }
    diff.mission.randomPresets = JSON.stringify(baselineRandomPresets || { presets: [] }) !== JSON.stringify(randomPresets || { presets: [] });
    return diff;
  }, [baselineDefinitions, definitions, baselineFiles, lootFiles, baselineSpawnableTypesByGroup, spawnableTypesByGroup, baselineRandomPresets, randomPresets]);

  const storageDirty = useMemo(() => {
    const d = storageDiff;
    if (!d) return false;
    if (d.definitions.categories || d.definitions.usageflags || d.definitions.valueflags || d.definitions.tags) return true;
    for (const g of Object.keys(d.files)) {
      for (const f of Object.keys(d.files[g])) {
        if (d.files[g][f].changed) return true;
      }
    }
    if (d.mission?.randomPresets) return true;
    for (const files of Object.values(d.mission?.spawnableGroups || {})) {
      for (const changed of Object.values(files)) {
        if (changed) return true;
      }
    }
    return false;
  }, [storageDiff]);

  // Write staged changes (from lootFiles/IndexedDB) to server via PUT
  const persistChangesToServer = useCallback(async () => {
    if (!selectedProfileId) return { ok: false, error: 'No profile selected' };
    const API_BASE = getApiBase();
    const editorId = currentEditorIdRef.current || 'unknown';

    try {
      const d = storageDiff;

      // 1. Definitions
      if (d.definitions.categories || d.definitions.usageflags || d.definitions.valueflags || d.definitions.tags) {
        const xml = generateLimitsXml(definitions);
        const res = await fetchWithProfile(`${API_BASE}/api/definitions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/xml', 'X-Editor-ID': editorId },
          body: xml
        });
        if (!res.ok) throw new Error(`Failed to save definitions: ${res.statusText}`);
      }

      // 2. CLE Types
      for (const [group, files] of Object.entries(d.files)) {
        if (group === 'vanilla') continue; // Always skip vanilla (overrides are in vanilla_overrides)
        for (const [file, info] of Object.entries(files)) {
          if (info.changed) {
            const types = lootFiles[group]?.[file] || [];
            const xml = generateTypesXml(types);
            const res = await fetchWithProfile(`${API_BASE}/api/types/${encodeURIComponent(group)}/${encodeURIComponent(file)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/xml', 'X-Editor-ID': editorId },
              body: xml
            });
            if (!res.ok) throw new Error(`Failed to save ${group}/${file}: ${res.statusText}`);
          }
        }
      }

      // 3. Spawnable Types
      for (const [group, files] of Object.entries(d.mission.spawnableGroups)) {
        for (const [file, changed] of Object.entries(files)) {
          if (changed) {
            const data = spawnableTypesByGroup[group]?.[file] || { types: [] };
            const xml = generateSpawnableTypesXml(data);
            const res = await fetchWithProfile(`${API_BASE}/api/spawnabletypes/${encodeURIComponent(group)}/${encodeURIComponent(file)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/xml', 'X-Editor-ID': editorId },
              body: xml
            });
            if (!res.ok) throw new Error(`Failed to save spawnable types ${group}/${file}: ${res.statusText}`);
          }
        }
      }

      // 4. Random Presets
      if (d.mission.randomPresets) {
        const xml = generateRandomPresetsXml(randomPresets);
        const res = await fetchWithProfile(`${API_BASE}/api/mission/randompresets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/xml', 'X-Editor-ID': editorId },
          body: xml
        });
        if (!res.ok) throw new Error(`Failed to save random presets: ${res.statusText}`);
      }

      // After all saved successfully, refresh baseline from server to clear diffs
      await refreshBaselineFromAPI();
      return { ok: true };
    } catch (e) {
      console.error('Persistence failed:', e);
      return { ok: false, error: e.message };
    }
  }, [selectedProfileId, storageDiff, definitions, lootFiles, spawnableTypesByGroup, randomPresets, fetchWithProfile, refreshBaselineFromAPI]);


  const setFromMergedTypes = useCallback((nextMerged, opts = { persist: false }) => {
    if (!lootFiles) return;

    // Build a lookup by group+file+name -> updated type (ignore meta props on write)
    /** @type {Map<string, Type & {group?: string, file?: string}>} */
    const updatedIndex = new Map(
      nextMerged.map(t => [`${t.group}:${t.file}:${t.name}`, t])
    );

    // Track vanilla overrides to upsert into vanilla_overrides
    /** @type {Map<string, Type>} */
    const vanillaOverrides = new Map();

    // Rebuild file-level structure by replacing types where updated
    /** @type {TypeFiles} */
    const updatedFiles = Object.fromEntries(
      Object.entries(lootFiles).map(([group, files]) => {
        const nextFiles = Object.fromEntries(
          Object.entries(files).map(([file, arr]) => {
            const replaced = arr.map(orig => {
              const upd = updatedIndex.get(`${group}:${file}:${orig.name}`);
              if (upd) {
                const { group: _g, file: _f, ...rest } = upd;
                // If editing a vanilla entry, do not modify vanilla; instead, stage an override
                if (group === 'vanilla') {
                  const candidate = { ...orig, ...rest };
                  const changed = JSON.stringify(normalizeType(candidate)) !== JSON.stringify(normalizeType(orig));
                  if (changed) {
                    vanillaOverrides.set(orig.name, candidate);
                  }
                  // keep original vanilla record unchanged
                  return orig;
                }
                // Non-vanilla groups: apply replacement as usual
                return { ...orig, ...rest };
              }
              return orig;
            });
            return [file, replaced];
          })
        );
        return [group, nextFiles];
      })
    );

    // Apply/upsert vanilla overrides into group 'vanilla_overrides' under file 'types'
    if (vanillaOverrides.size > 0) {
      if (!updatedFiles['vanilla_overrides']) {
        updatedFiles['vanilla_overrides'] = {};
      }
      const targetFile = 'types';
      // Remove any previous overrides for the same names across all files in vanilla_overrides
      const namesToReplace = new Set(vanillaOverrides.keys());
      for (const [f, arr] of Object.entries(updatedFiles['vanilla_overrides'])) {
        updatedFiles['vanilla_overrides'][f] = arr.filter(t => !namesToReplace.has(t.name));
      }
      // Ensure target file exists
      if (!updatedFiles['vanilla_overrides'][targetFile]) {
        updatedFiles['vanilla_overrides'][targetFile] = [];
      }
      // Upsert new/updated overrides
      const bucket = updatedFiles['vanilla_overrides'][targetFile];
      for (const [, t] of vanillaOverrides) {
        // Replace if already present in target bucket
        const idx = bucket.findIndex(x => x.name === t.name);
        if (idx >= 0) bucket[idx] = t;
        else bucket.push(t);
      }
    }

    // Compute changes vs previous lootFiles
    try {
      const editorID = currentEditorIdRef.current || 'unknown';
      const ts = Date.now();
      /** @type {{ts:number, editorID:string, group:string, file:string, typeName:string, action:'added'|'modified'|'removed', fields?: string[]}[]} */
      const logs = [];
      for (const [g, perFileNew] of Object.entries(updatedFiles)) {
        const perFileOld = (lootFiles[g] || {});
        const fileKeys = new Set([...Object.keys(perFileOld), ...Object.keys(perFileNew)]);
        for (const f of fileKeys) {
          const oldArr = perFileOld[f] || [];
          const newArr = perFileNew[f] || [];
          const oldBy = new Map(oldArr.map(t => [t.name, normalizeType(t)]));
          const newBy = new Map(newArr.map(t => [t.name, normalizeType(t)]));
          for (const name of newBy.keys()) {
            if (!oldBy.has(name)) {
              logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'added' });
            } else {
              const a = oldBy.get(name);
              const b = newBy.get(name);
              if (JSON.stringify(a) !== JSON.stringify(b)) {
                const { fields, oldValues, newValues } = diffChangedFields(a, b);
                logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'modified', fields, oldValues, newValues });
              }
            }
          }
          for (const name of oldBy.keys()) {
            if (!newBy.has(name)) {
              logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'removed' });
            }
          }
        }
      }
      if (logs.length) {
        appendChangeLogs(logs).catch(err => console.error('Failed to append logs:', err));
      }
    } catch {
      // ignore logging errors
    }

    setLootFiles(updatedFiles);

    // Derive grouped and merged views
    const updatedGroups = combineFilesToGroups(updatedFiles);
    setLootGroups(updatedGroups);
    const merged = mergeFromFiles(updatedFiles);
    _setLootTypes(merged);

    // Persist per-file if requested
    if (opts.persist) {
      const records = [];
      for (const [group, files] of Object.entries(updatedFiles)) {
        for (const [file, arr] of Object.entries(files)) {
          records.push({ group, file, types: arr });
        }
      }
      void saveManyTypeFiles(records);
    }

    if (definitions) {
      setUnknowns(validateUnknowns(merged, definitions));
    }
  }, [lootFiles, definitions]);

  const setLootTypes = useCallback((next, opts = { persist: false }) => {
    // Keep backward compatibility with callers; interpret as merged array and project back to groups
    setFromMergedTypes(next, opts);
  }, [setFromMergedTypes]);

  useEffect(() => {
    if (!profilesLoaded) return;

    if (!selectedProfileId) {
      setLoading(false);
      setError(prev => (prev && String(prev).includes('backend server')) ? prev : null);
      setDefinitions(null);
      setLootFiles(null);
      setLootGroups(null);
      _setLootTypes(null);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Determine API base
        const savedBase = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
        const defaultBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4317` : 'http://localhost:4317';
        const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

        // Probe API
        let apiOk = false;
        try {
          const health = await fetchWithProfile(`${API_BASE}/api/health`);
          apiOk = health.ok;
        } catch {
          apiOk = false;
        }
        if (!apiOk) {
          throw new Error('Live data API is unavailable. Set dayz-editor:apiBase and start the persistence server.');
        }

        // Load definitions from API
        let defs;
        try {
          const limitsRes = await fetchWithProfile(`${API_BASE}/api/definitions`);
          if (!limitsRes.ok) throw new Error('definitions missing');
          const limitsText = await limitsRes.text();
          defs = parseLimitsXml(limitsText);
        } catch {
          throw new Error('cfglimitsdefinition.xml is missing or invalid in the live data API.');
        }

        // Try file-level records from IndexedDB
        /** @type {TypeFiles|null} */
        let files = await loadAllGrouped();
        if (files && Object.keys(files).length === 0) files = null;

        // Fallback: legacy flat storage to seed IDB as vanilla/types (optional)
        if (!files) {
          /** @type {Type[]|null} */
          const legacy = loadFromStorage(LEGACY_STORAGE_KEY_TYPES) || null;
          if (legacy) {
            files = { vanilla: { types: legacy } };
            await saveManyTypeFiles([{ group: 'vanilla', file: 'types', types: legacy }]);
          }
        }

        // If still empty, build from API and seed IDB per file
        if (!files) {
          /** @type {TypeFiles} */
          const assembledFiles = {};
          /** @type {string[]} */
          const warnings = [];

          // 1) Vanilla base (data/db/types.xml)
          try {
            const vanillaRes = await fetchWithProfile(`${API_BASE}/api/types/vanilla/types`);
            if (!vanillaRes.ok) throw new Error('vanilla types missing');
            const vanillaText = await vanillaRes.text();
            let vanilla = parseTypesXml(vanillaText);
            // Ignore world/static objects (case-insensitive for "static_")
            vanilla = vanilla.filter(t => {
              const n = t.name || '';
              const lower = n.toLowerCase();
              return !(n.startsWith('Land_') || n.startsWith('StaticObj_') || lower.startsWith('static_'));
            });
            assembledFiles.vanilla = { types: vanilla };
          } catch {
            throw new Error('Vanilla types are missing from the live data API.');
          }

          // 2) Additional groups from economy core (ordered)
          try {
            const econRes = await fetchWithProfile(`${API_BASE}/api/economycore`);
            if (econRes.ok) {
              const econText = await econRes.text();
              const { order, filesByGroup } = parseEconomyCoreXml(econText);
              for (const group of order) {
                const filesList = filesByGroup[group] || [];
                for (const samplePath of filesList) {
                  const parts = samplePath.split('/');
                  const fileName = parts[parts.length - 1] || 'types.xml';
                  const fileBase = fileName.replace(/\.xml$/i, '');
                  try {
                    const res = await fetchWithProfile(`${API_BASE}/api/types/${encodeURIComponent(group)}/${encodeURIComponent(fileBase)}`);
                    if (!res.ok) {
                      warnings.push(`Group "${group}" file "${fileBase}": not found or cannot be read.`);
                      continue;
                    }
                    const text = await res.text();
                    try {
                      const parsed = parseTypesXml(text);
                      if (!assembledFiles[group]) assembledFiles[group] = {};
                      assembledFiles[group][fileBase] = parsed;
                    } catch (e) {
                      warnings.push(`Group "${group}" file "${fileBase}": failed to parse XML (${String(e && e.message ? e.message : e)}).`);
                    }
                  } catch {
                    warnings.push(`Group "${group}" file "${fileBase}": request failed.`);
                  }
                }
              }
            }
          } catch {
            // ignore extra groups if economy core is missing or invalid
          }

          // 3) Include canonical overrides if present (treat like any other group)
          // Server returns an empty <types/> doc if the file doesn't exist yet.
          try {
            const or = await fetchWithProfile(`${API_BASE}/api/types/vanilla_overrides/types`);
            if (or.ok) {
              const oText = await or.text();
              try {
                const overrides = parseTypesXml(oText);
                // Insert overrides last so they take precedence in mergeFromFiles
                assembledFiles['vanilla_overrides'] = { types: overrides };
              } catch (e) {
                warnings.push(`Group "vanilla_overrides" file "types": failed to parse XML (${String(e && e.message ? e.message : e)}).`);
              }
            }
          } catch {
            // ignore overrides if endpoint fails
          }

          if (!Object.keys(assembledFiles).length) {
            throw new Error('Live data API returned no types data.');
          }

          // Persist initial build per file into IndexedDB
          const records = [];
          for (const [group, perFile] of Object.entries(assembledFiles)) {
            for (const [file, arr] of Object.entries(perFile)) {
              records.push({ group, file, types: arr });
            }
          }
          await saveManyTypeFiles(records);
          files = assembledFiles;

          // Publish any warnings discovered during build
          setLoadWarnings(warnings);
        }
        else {
          // Loading from IndexedDB/legacy path: no file parsing performed here → clear warnings
          setLoadWarnings([]);
        }

        if (!mounted) return;

        setDefinitions(defs);
        setBaselineDefinitions(defs);
        setLootFiles(files);
        const missionWarnings = [];
        await loadMissionFilesFromAPI(API_BASE, files, missionWarnings);
        if (missionWarnings.length > 0) {
          setLoadWarnings(prev => [...prev, ...missionWarnings]);
        }

        // Derive grouped and merged views
        const groups = combineFilesToGroups(files);
        setLootGroups(groups);

        const merged = mergeFromFiles(files);
        _setLootTypes(merged);

        setUnknowns(validateUnknowns(merged, defs));
        historyRef.current = createHistory(merged);

        // Prepare and show one-time summary of loaded data
        const groupOrder = Object.keys(groups).sort((a, b) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : 0));
        const fileCount = Object.values(files).reduce((n, perFile) => n + Object.keys(perFile || {}).length, 0);
        const summaryPayload = {
          typeCount: merged.length,
          groupCount: groupOrder.length,
          fileCount,
          definitionCounts: {
            categories: defs.categories.length,
            usageflags: defs.usageflags.length,
            valueflags: defs.valueflags.length,
            tags: defs.tags.length,
          },
        };
        const alreadyShown = !!loadFromStorage(STORAGE_KEY_SUMMARY_SHOWN);
        if (!alreadyShown) {
          setLoadSummary(summaryPayload);
          setSummaryOpen(true);
          saveToStorage(STORAGE_KEY_SUMMARY_SHOWN, true);
        }

        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [selectedProfileId, fetchWithProfile, loadMissionFilesFromAPI, profilesLoaded]);

  const pushHistory = useCallback((state) => {
    historyRef.current.push(state);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) {
      setFromMergedTypes(prev, { persist: true });
    }
  }, [setFromMergedTypes]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) {
      setFromMergedTypes(next, { persist: true });
    }
  }, [setFromMergedTypes]);

  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;

  /**
   * Count how many types reference a given entry by kind.
   * @param {'usage'|'value'|'tag'} kind
   * @param {string} entry
   * @returns {number}
   */
  const countDefinitionRefs = useCallback((kind, entry) => {
    const arr = lootTypes || [];
    if (kind === 'usage') return arr.filter(t => t.usage.includes(entry)).length;
    if (kind === 'value') return arr.filter(t => t.value.includes(entry)).length;
    return arr.filter(t => t.tag.includes(entry)).length;
  }, [lootTypes]);

  /**
   * Remove an entry from definitions and from all types; persist and push history.
   * @param {'usage'|'value'|'tag'} kind
   * @param {string} entry
   */
  const removeDefinitionEntry = useCallback((kind, entry) => {
    if (!lootFiles) return;

    // Update files by removing the entry from all types in all files
    /** @type {TypeFiles} */
    const nextFiles = Object.fromEntries(
      Object.entries(lootFiles).map(([g, files]) => {
        const nextPerFile = Object.fromEntries(
          Object.entries(files).map(([f, arr]) => {
            const cleaned = arr.map(t => {
              const next = { ...t };
              if (kind === 'usage') next.usage = next.usage.filter(x => x !== entry);
              else if (kind === 'value') next.value = next.value.filter(x => x !== entry);
              else next.tag = next.tag.filter(x => x !== entry);
              return next;
            });
            return [f, cleaned];
          })
        );
        return [g, nextPerFile];
      })
    );

    // Log modifications vs previous files
    try {
      const editorID = currentEditorIdRef.current || 'unknown';
      const ts = Date.now();
      /** @type {{ts:number, editorID:string, group:string, file:string, typeName:string, action:'modified', fields?: string[]}[]} */
      const logs = [];
      for (const [g, perFileNew] of Object.entries(nextFiles)) {
        const perFileOld = (lootFiles[g] || {});
        for (const [f, newArr] of Object.entries(perFileNew)) {
          const oldArr = perFileOld[f] || [];
          const oldBy = new Map(oldArr.map(t => [t.name, normalizeType(t)]));
          const newBy = new Map(newArr.map(t => [t.name, normalizeType(t)]));
          for (const name of newBy.keys()) {
            if (oldBy.has(name)) {
              const a = oldBy.get(name);
              const b = newBy.get(name);
              if (JSON.stringify(a) !== JSON.stringify(b)) {
                const { fields, oldValues, newValues } = diffChangedFields(a, b);
                logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'modified', fields, oldValues, newValues });
              }
            }
          }
        }
      }
      if (logs.length) {
        appendChangeLogs(logs).catch(err => console.error('Failed to append logs:', err));
      }
    } catch {
      // ignore logging errors
    }

    // Persist and refresh derived state
    setLootFiles(nextFiles);
    const records = [];
    for (const [g, perFile] of Object.entries(nextFiles)) {
      for (const [f, arr] of Object.entries(perFile)) {
        records.push({ group: g, file: f, types: arr });
      }
    }
    void saveManyTypeFiles(records);

    const groups = combineFilesToGroups(nextFiles);
    setLootGroups(groups);
    const merged = mergeFromFiles(nextFiles);
    _setLootTypes(merged);
    if (definitions) setUnknowns(validateUnknowns(merged, definitions));
    historyRef.current.push(merged);

    // Update definitions to remove the entry
    setDefinitions(d => {
      if (!d) return d;
      const next =
        kind === 'usage' ? { ...d, usageflags: d.usageflags.filter(x => x !== entry) } :
        kind === 'value' ? { ...d, valueflags: d.valueflags.filter(x => x !== entry) } :
        { ...d, tags: d.tags.filter(x => x !== entry) };
      // Recompute unknowns against the just-rebuilt types (`merged`, with the entry removed)
      // and the updated definitions — not the stale `lootTypes` closure.
      setUnknowns(validateUnknowns(merged, next));
      return next;
    });
  }, [definitions, lootFiles]);

  /**
   * Add an entry to definitions.
   * @param {'usage'|'value'|'tag'} kind
   * @param {string} entry
   */
  const addDefinitionEntry = useCallback((kind, entry) => {
    const value = (entry || '').trim();
    if (!value) return;
    setDefinitions(d => {
      if (!d) return d;
      let next = d;
      if (kind === 'usage') {
        // Preserve original ordering; append to the end if not present
        if (d.usageflags.includes(value)) return d;
        next = { ...d, usageflags: [...d.usageflags, value] };
      } else if (kind === 'value') {
        if (d.valueflags.includes(value)) return d;
        next = { ...d, valueflags: [...d.valueflags, value].sort() };
      } else {
        if (d.tags.includes(value)) return d;
        next = { ...d, tags: [...d.tags, value].sort() };
      }
      // Recompute unknowns with updated definitions
      setUnknowns(validateUnknowns(lootTypes || [], next));
      return next;
    });
  }, [lootTypes]);

  // Unknowns resolution modal control and logic
  const [unknownsOpen, setUnknownsOpen] = useState(false);
  const hasPromptedUnknownsRef = useRef(false);
  useEffect(() => {
    if (!hasPromptedUnknownsRef.current && unknowns.hasAny) {
      setUnknownsOpen(true);
      hasPromptedUnknownsRef.current = true;
    }
  }, [unknowns]);

  const resolveUnknowns = useMemo(() => ({
    isOpen: unknownsOpen,
    open: () => setUnknownsOpen(true),
    close: () => setUnknownsOpen(false),
    apply: ({ add, remove }) => {
      // Update definitions
      setDefinitions(d => {
        if (!d) return d;
        const next = {
          categories: uniq([...d.categories, ...add.category]),
          usageflags: uniq([...d.usageflags, ...add.usage]),
          valueflags: uniq([...d.valueflags, ...add.value]),
          tags: uniq([...d.tags, ...add.tag]),
        };
        // Update unknowns with new defs
        setUnknowns(validateUnknowns(lootTypes || [], next));
        return next;
      });
      // Update types if removing unknowns that remain unknown after additions
      if (remove && lootTypes) {
        // Compute which unknowns to remove (exclude those user chose to add)
        const removeUsage = new Set([...unknowns.sets.usage].filter(x => !add.usage.includes(x)));
        const removeValue = new Set([...unknowns.sets.value].filter(x => !add.value.includes(x)));
        const removeTag = new Set([...unknowns.sets.tag].filter(x => !add.tag.includes(x)));
        const removeCategory = new Set([...unknowns.sets.category].filter(x => !add.category.includes(x)));

        const cleaned = lootTypes.map(t => {
          const next = { ...t };
          if (next.category && removeCategory.has(next.category)) {
            next.category = undefined;
          }
          next.usage = next.usage.filter(u => !removeUsage.has(u));
          next.value = next.value.filter(v => !removeValue.has(v));
          next.tag = next.tag.filter(g => !removeTag.has(g));
          return next;
        });
        setFromMergedTypes(cleaned, { persist: true });
        pushHistory(cleaned);
      } else {
        // just close; definitions are already updated in state
      }
      setUnknownsOpen(false);
    }
  }), [unknownsOpen, unknowns, lootTypes, setFromMergedTypes, pushHistory]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Ordered groups list for UI: vanilla first, then the rest as defined by insertion order in object
  const groupsList = useMemo(() => {
    if (!lootFiles) return [];
    const keys = Object.keys(lootFiles);
    return keys.includes('vanilla') ? ['vanilla', ...keys.filter(k => k !== 'vanilla')] : keys;
  }, [lootFiles]);

  /**
   * Get types array for a given group.
   * @param {string} group
   * @returns {Type[]}
   */
  const getGroupTypes = useCallback((group) => {
    if (!lootFiles || !lootFiles[group]) return [];
    /** @type {Type[]} */
    const combined = [];
    for (const arr of Object.values(lootFiles[group])) combined.push(...arr);
    return combined;
  }, [lootFiles]);

  /**
   * Reload all data from live API, clearing IndexedDB (types + change log) and local grouped keys.
   */
  const reloadFromFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setLoadWarnings([]);

      // Clear IndexedDB stores and any legacy/local grouped cache
      await clearAllTypeFiles();
      await clearChangeLog();
      try {
        localStorage.removeItem(STORAGE_KEY_GROUPS);
        localStorage.removeItem(LEGACY_STORAGE_KEY_TYPES);
      } catch {
        // ignore
      }

      // API base
      const savedBase = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
      const defaultBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4317` : 'http://localhost:4317';
      const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

      // Reload definitions from API
      let defs;
      try {
        const limitsRes = await fetchWithProfile(`${API_BASE}/api/definitions`);
        if (!limitsRes.ok) throw new Error('definitions not found');
        const limitsText = await limitsRes.text();
        defs = parseLimitsXml(limitsText);
      } catch {
        throw new Error('Live data API is unavailable or cfglimitsdefinition.xml is missing.');
      }

      // Build from API (vanilla + cfgeconomycore order)
      /** @type {TypeFiles} */
      const assembledFiles = {};
      /** @type {string[]} */
      const warnings = [];

      // Vanilla base (data/db/types.xml)
      try {
        const vRes = await fetchWithProfile(`${API_BASE}/api/types/vanilla/types`);
        if (vRes.ok) {
          let vText = await vRes.text();
          let vanilla = parseTypesXml(vText);
          vanilla = vanilla.filter(t => {
            const n = t.name || '';
            const lower = n.toLowerCase();
            return !(n.startsWith('Land_') || n.startsWith('StaticObj_') || lower.startsWith('static_'));
          });
          assembledFiles.vanilla = { types: vanilla };
        } else {
          throw new Error('vanilla types not found');
        }
      } catch {
        throw new Error('Live data API is missing vanilla types.');
      }

      // Additional groups via cfgeconomycore
      try {
        const econRes = await fetchWithProfile(`${API_BASE}/api/economycore`);
        if (econRes.ok) {
          const econText = await econRes.text();
          const { order, filesByGroup, spawnableFilesByGroup: sFiles } = parseEconomyCoreXml(econText);

          // Ensure mission root spawnable types file is included in the map
          const sFilesWithRoot = { ...sFiles };
          if (!sFilesWithRoot[ROOT_SPAWNABLE_GROUP]) {
            sFilesWithRoot[ROOT_SPAWNABLE_GROUP] = ['cfgspawnabletypes.xml'];
          }
          setSpawnableFilesByGroup(sFilesWithRoot);


          for (const group of order) {
            const filesList = filesByGroup[group] || [];
            for (const samplePath of filesList) {
              const parts = samplePath.split('/');
              const fileName = parts[parts.length - 1] || 'types.xml';
              const fileBase = fileName.replace(/\.xml$/i, '');
              try {
                const res = await fetchWithProfile(`${API_BASE}/api/types/${encodeURIComponent(group)}/${encodeURIComponent(fileBase)}`);
                if (!res.ok) {
                  warnings.push(`Group "${group}" file "${fileBase}": not found or cannot be read.`);
                  continue;
                }
                const text = await res.text();
                try {
                  const parsed = parseTypesXml(text);
                  if (!assembledFiles[group]) assembledFiles[group] = {};
                  assembledFiles[group][fileBase] = parsed;
                } catch (e) {
                  warnings.push(`Group "${group}" file "${fileBase}": failed to parse XML (${String(e && e.message ? e.message : e)}).`);
                }
              } catch {
                warnings.push(`Group "${group}" file "${fileBase}": request failed.`);
              }
            }
          }
        }
      } catch {
        // ignore extra groups if economy core missing
      }

      // Include canonical overrides as a proper group (always last to be canonical)
      try {
        const or = await fetchWithProfile(`${API_BASE}/api/types/vanilla_overrides/types`);
        if (or.ok) {
          const oText = await or.text();
          try {
            const overrides = parseTypesXml(oText);
            assembledFiles['vanilla_overrides'] = { types: overrides };
          } catch (e) {
            warnings.push(`Group "vanilla_overrides" file "types": failed to parse XML (${String(e && e.message ? e.message : e)}).`);
          }
        }
      } catch {
        // ignore if not available
      }

      if (!Object.keys(assembledFiles).length) {
        throw new Error('Live data API returned no types data.');
      }

      // Persist per file into IndexedDB
      const records = [];
      for (const [group, perFile] of Object.entries(assembledFiles)) {
        for (const [file, arr] of Object.entries(perFile)) {
          records.push({ group, file, types: arr });
        }
      }
      await saveManyTypeFiles(records);
      await loadMissionFilesFromAPI(API_BASE, assembledFiles, warnings);

      // Reset state, baselines, history, unknowns
      setDefinitions(defs);
      setBaselineDefinitions(defs);
      setLootFiles(assembledFiles);

      const groupsCombined = combineFilesToGroups(assembledFiles);
      setLootGroups(groupsCombined);

      const merged = mergeFromFiles(assembledFiles);
      _setLootTypes(merged);
      setUnknowns(validateUnknowns(merged, defs));
      historyRef.current = createHistory(merged);

      // Reset baselines to newly parsed
      setBaselineFiles(assembledFiles);

      // Publish warnings collected during reload
      setLoadWarnings(warnings);

      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, [fetchWithProfile, loadMissionFilesFromAPI]);

  /**
   * Get per-file breakdown for a group.
   * @param {string} group
   * @returns {{file: string, types: Type[]}[]}
   */
  const getGroupFiles = useCallback((group) => {
    if (!lootFiles || !lootFiles[group]) return [];
    return Object.entries(lootFiles[group]).map(([file, types]) => ({ file, types }));
  }, [lootFiles]);

  /**
   * Get baseline types array for a given group and file.
   * @param {string} group
   * @param {string} file
   * @returns {Type[]}
   */
  const getBaselineFileTypes = useCallback((group, file) => {
    if (!baselineFiles) return [];
    return (baselineFiles[group]?.[file]) || [];
  }, [baselineFiles]);


  // Track current editor ID for change logging
  const currentEditorIdRef = useRef(/** @type {string} */(''));
  const setChangeEditorID = useCallback((id) => {
    currentEditorIdRef.current = id || '';
  }, []);

  // One-time manual change logging for differences between parsed files (baseline) and IndexedDB state
  const manualLoggedRef = useRef(false);
  useEffect(() => {
    if (manualLoggedRef.current) return;
    if (!baselineFiles || !lootFiles) return;

    const ts = Date.now();
    const editorID = 'Manual Change';
    /** @type {{ts:number, editorID:string, group:string, file:string, typeName:string, action:'added'|'modified'|'removed', fields?: string[], oldValues?: Record<string, any>, newValues?: Record<string, any>}[]} */
    const logs = [];

    const allGroups = new Set([...Object.keys(baselineFiles), ...Object.keys(lootFiles)]);
    for (const g of allGroups) {
      const basePer = baselineFiles[g] || {};
      const currPer = lootFiles[g] || {};
      const allFiles = new Set([...Object.keys(basePer), ...Object.keys(currPer)]);
      for (const f of allFiles) {
        const baseArr = basePer[f] || [];
        const currArr = currPer[f] || [];
        const baseBy = new Map(baseArr.map(t => [t.name, normalizeType(t)]));
        const currBy = new Map(currArr.map(t => [t.name, normalizeType(t)]));

        // Added
        for (const name of currBy.keys()) {
          if (!baseBy.has(name)) {
            logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'added' });
          }
        }
        // Removed
        for (const name of baseBy.keys()) {
          if (!currBy.has(name)) {
            logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'removed' });
          }
        }
        // Modified
        for (const name of [...baseBy.keys()].filter(n => currBy.has(n))) {
          const a = baseBy.get(name);
          const b = currBy.get(name);
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            const { fields, oldValues, newValues } = diffChangedFields(a, b);
            logs.push({ ts, editorID, group: g, file: f, typeName: name, action: 'modified', fields, oldValues, newValues });
          }
        }
      }
    }

    if (logs.length) {
      appendChangeLogs(logs).catch(err => console.error('Failed to append logs:', err)).finally(() => {
        manualLoggedRef.current = true;
      });
    } else {
      manualLoggedRef.current = true;
    }
  }, [baselineFiles, lootFiles]);

  return {
    loading,
    error,
    definitions,
    lootTypes,
    loadWarnings,
    setLootTypes,
    filters,
    setFilters,
    selection,
    setSelection,
    lastClickedId,
    setLastClickedId,
    pushHistory,
    undo,
    redo,
    canUndo: canUndo(),
    canRedo: canRedo(),
    unknowns,
    resolveUnknowns,
    groups: groupsList,
    getGroupTypes,
    getGroupFiles,
    storageDirty,
    storageDiff,
    // Summary modal
    summary: loadSummary,
    summaryOpen,
    closeSummary: () => setSummaryOpen(false),
    // Management helpers
    manage: {
      countRefs: countDefinitionRefs,
      removeEntry: removeDefinitionEntry,
      addEntry: addDefinitionEntry
    },
    setChangeEditorID,
    reloadFromFiles,
    getBaselineFileTypes,
    persistChangesToServer,
    refreshBaselineFromAPI,
    spawnableFilesByGroup,
    spawnableTypesByGroup,
    setSpawnableTypesByGroup,
    baselineSpawnableTypesByGroup,
    randomPresets,
    setRandomPresets,
    baselineRandomPresets,
    globalsDefaults,
    loadouts,
    setLoadouts,
    // Profiles
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    loadProfiles,
    fetchWithProfile
  };
}

/**
 * Combine file-level structure to grouped per group (concatenate files).
 * @param {TypeFiles} files
 * @returns {TypeGroups}
 */
function combineFilesToGroups(files) {
  /** @type {TypeGroups} */
  const groups = {};
  for (const [group, perFile] of Object.entries(files)) {
    groups[group] = [];
    for (const arr of Object.values(perFile)) {
      groups[group].push(...arr);
    }
  }
  return groups;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Merge file-level types to a single array adding group and file metadata.
 * If multiple groups contain a type with the same name, the last group in order wins:
 * vanilla is loaded first, then additional groups (object key order).
 * @param {TypeFiles} files
 * @returns {(Type & {group: string, file: string})[]}
 */
export function mergeFromFiles(files) {
  const groups = Object.keys(files);
  const orderedGroups = groups.sort((a, b) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : 0));

  /** @type {Map<string, Type & {group: string, file: string}>} */
  const byName = new Map();

  for (const group of orderedGroups) {
    const perFile = files[group];
    for (const [file, arr] of Object.entries(perFile)) {
      for (const t of arr) {
        byName.set(t.name, { ...t, group, file });
      }
    }
  }
  return Array.from(byName.values());
}


function normalizeType(t) {
  return {
    name: t.name,
    category: t.category || null,
    nominal: t.nominal, min: t.min, lifetime: t.lifetime, restock: t.restock,
    quantmin: t.quantmin, quantmax: t.quantmax,
    flags: t.flags,
    usage: [...t.usage].sort(),
    value: [...t.value].sort(),
    tag: [...t.tag].sort(),
  };
}

/**
 * Diff two normalized types; return changed field names plus old/new values for those fields.
 * @param {ReturnType<typeof normalizeType>} a
 * @param {ReturnType<typeof normalizeType>} b
 * @returns {{fields: string[], oldValues: Record<string, any>, newValues: Record<string, any>}}
 */
function diffChangedFields(a, b) {
  const fields = [];
  /** @type {Record<string, any>} */
  const oldValues = {};
  /** @type {Record<string, any>} */
  const newValues = {};

  const maybeAdd = (key, oldVal, newVal) => {
    fields.push(key);
    oldValues[key] = oldVal;
    newValues[key] = newVal;
  };

  if (a.category !== b.category) maybeAdd('Category', a.category, b.category);
  if (a.nominal !== b.nominal) maybeAdd('Nominal', a.nominal, b.nominal);
  if (a.min !== b.min) maybeAdd('Min', a.min, b.min);
  if (a.lifetime !== b.lifetime) maybeAdd('Lifetime', a.lifetime, b.lifetime);
  if (a.restock !== b.restock) maybeAdd('Restock', a.restock, b.restock);
  if (a.quantmin !== b.quantmin) maybeAdd('Quantmin', a.quantmin, b.quantmin);
  if (a.quantmax !== b.quantmax) maybeAdd('Quantmax', a.quantmax, b.quantmax);

  if (JSON.stringify(a.flags) !== JSON.stringify(b.flags)) {
    maybeAdd('Flags', a.flags, b.flags);
  }
  if (JSON.stringify(a.usage) !== JSON.stringify(b.usage)) {
    maybeAdd('Usage', a.usage, b.usage);
  }
  if (JSON.stringify(a.value) !== JSON.stringify(b.value)) {
    maybeAdd('Value', a.value, b.value);
  }
  if (JSON.stringify(a.tag) !== JSON.stringify(b.tag)) {
    maybeAdd('Tag', a.tag, b.tag);
  }

  return { fields, oldValues, newValues };
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function makeUnknownsEmpty() {
  return {
    hasAny: false,
    sets: { usage: new Set(), value: new Set(), tag: new Set(), category: new Set() },
    byType: {}
  };
}
